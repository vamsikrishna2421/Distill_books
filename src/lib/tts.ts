import { useSyncExternalStore } from 'react'
import { getPrefs, updatePrefs } from './prefs'

// ---------------------------------------------------------------------------
// Text-to-speech engine over the Web Speech API. One global playback session,
// consumed by any page via useTts(). Text is chunked by sentence — long
// utterances get cut off on several platforms. Each chunk remembers which
// source block it came from and its character range within that block's
// whitespace-normalized text, so pages can highlight and follow along.
// ---------------------------------------------------------------------------

export interface TtsState {
  status: 'idle' | 'playing' | 'paused'
  index: number
  total: number
  currentText: string
  label: string
  charsRemaining: number
  /** index into the blocks array passed to ttsStart */
  block: number
  /** current sentence's range within the normalized block text */
  charStart: number
  charEnd: number
  /** bumped when the voice list loads/changes so components re-render */
  voicesVersion: number
}

export const ttsSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window

const IDLE: TtsState = {
  status: 'idle',
  index: 0,
  total: 0,
  currentText: '',
  label: '',
  charsRemaining: 0,
  block: 0,
  charStart: 0,
  charEnd: 0,
  voicesVersion: 0,
}

let state: TtsState = IDLE
const listeners = new Set<() => void>()

function emit(patch: Partial<TtsState>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useTts(): TtsState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

// --- Voices -----------------------------------------------------------------

let voices: SpeechSynthesisVoice[] = []

function refreshVoices(): void {
  voices = speechSynthesis.getVoices()
  emit({ voicesVersion: state.voicesVersion + 1 })
}

if (ttsSupported) {
  refreshVoices()
  speechSynthesis.addEventListener('voiceschanged', refreshVoices)
}

/** Heuristic quality ranking — prefer neural/enhanced system voices over the
    compact robotic ones many platforms expose as the default. */
function voiceScore(v: SpeechSynthesisVoice): number {
  const n = `${v.name} ${v.voiceURI}`.toLowerCase()
  let s = 0
  if (n.includes('natural') || n.includes('neural')) s += 8
  if (n.includes('siri')) s += 7
  if (n.includes('premium') || n.includes('enhanced')) s += 6
  if (n.includes('google')) s += 5
  if (n.includes('samantha') || n.includes('ava') || n.includes('zoe')) s += 3
  if (!v.localService) s += 2
  if (v.lang.toLowerCase() === 'en-us') s += 1
  if (n.includes('compact')) s -= 4
  // macOS novelty voices
  if (/fred|albert|zarvox|bells|trinoids|boing|bubbles|bahh|jester|organ|whisper/.test(n)) s -= 8
  return s
}

export function voicesForUi(): SpeechSynthesisVoice[] {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  const list = en.length ? en : [...voices]
  return [...list].sort((a, b) => voiceScore(b) - voiceScore(a))
}

function pickVoice(): SpeechSynthesisVoice | null {
  const wanted = getPrefs().ttsVoice
  if (wanted) {
    const match = voices.find((v) => v.voiceURI === wanted)
    if (match) return match
  }
  return voicesForUi()[0] ?? null
}

// --- Chunking ---------------------------------------------------------------

interface SentenceSpan {
  start: number
  end: number
}

interface Chunk {
  text: string
  block: number
  start: number
  end: number
  /** sentence ranges, chunk-relative — used for boundary-event highlighting */
  sentences: SentenceSpan[]
}

/** One utterance per paragraph keeps the engine's natural sentence prosody
    (per-sentence utterances sound abrupt). Very long paragraphs are split at
    sentence boundaries — some engines cut off oversized utterances. */
const MAX_UTTERANCE = 550

function sentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []
  const re = /[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const raw = m[0]
    const lead = raw.length - raw.trimStart().length
    const t = raw.trim()
    if (t) spans.push({ start: m.index + lead, end: m.index + lead + t.length })
  }
  return spans
}

function toChunks(blocks: string[]): Chunk[] {
  const out: Chunk[] = []
  blocks.forEach((rawBlock, b) => {
    const text = rawBlock.replace(/\s+/g, ' ').trim()
    if (!text) return
    const spans = sentenceSpans(text)
    if (spans.length === 0) return
    let groupStart = spans[0].start
    let groupEnd = spans[0].end
    const flush = () => {
      const t = text.slice(groupStart, groupEnd)
      out.push({ text: t, block: b, start: groupStart, end: groupEnd, sentences: sentenceSpans(t) })
    }
    for (let i = 1; i < spans.length; i++) {
      const s = spans[i]
      if (s.end - groupStart > MAX_UTTERANCE) {
        flush()
        groupStart = s.start
      }
      groupEnd = s.end
    }
    flush()
  })
  return out
}

// --- Playback ---------------------------------------------------------------

let chunks: Chunk[] = []
let onFinished: (() => void) | null = null
let session = 0
let keepalive: number | null = null

/** Chrome stops long speech sessions; a pause/resume tick keeps it alive.
    iOS WebKit glitches on that trick, so skip it there. */
const needsKeepalive =
  ttsSupported && !/iPhone|iPad|iPod/.test(navigator.userAgent)

function startKeepalive(): void {
  if (!needsKeepalive || keepalive !== null) return
  keepalive = window.setInterval(() => {
    if (state.status === 'playing') {
      speechSynthesis.pause()
      speechSynthesis.resume()
    }
  }, 10000)
}

function stopKeepalive(): void {
  if (keepalive !== null) {
    window.clearInterval(keepalive)
    keepalive = null
  }
}

function charsFrom(i: number): number {
  let n = 0
  for (let k = i; k < chunks.length; k++) n += chunks[k].text.length
  return n
}

function speakFrom(i: number): void {
  const mySession = session
  if (i >= chunks.length) {
    finish()
    return
  }
  const c = chunks[i]
  const first = c.sentences[0]
  emit({
    index: i,
    currentText: first ? c.text.slice(first.start, first.end) : c.text,
    charsRemaining: charsFrom(i),
    block: c.block,
    charStart: first ? c.start + first.start : c.start,
    charEnd: first ? c.start + first.end : c.end,
  })
  const u = new SpeechSynthesisUtterance(c.text)
  u.rate = getPrefs().ttsRate
  const voice = pickVoice()
  if (voice) u.voice = voice
  // track the spoken sentence inside the paragraph; engines without boundary
  // events simply keep the first-sentence/paragraph highlight
  let lastSentence = 0
  u.onboundary = (e) => {
    if (session !== mySession || typeof e.charIndex !== 'number') return
    const si = c.sentences.findIndex((s) => e.charIndex >= s.start && e.charIndex < s.end)
    if (si >= 0 && si !== lastSentence) {
      lastSentence = si
      const s = c.sentences[si]
      emit({
        currentText: c.text.slice(s.start, s.end),
        charStart: c.start + s.start,
        charEnd: c.start + s.end,
      })
    }
  }
  u.onend = () => {
    if (session === mySession && state.status !== 'idle') speakFrom(i + 1)
  }
  u.onerror = (e) => {
    if (session !== mySession || state.status === 'idle') return
    // blocked (no user gesture) or engine failure: stop rather than silently
    // racing through the queue; interrupted/canceled come from our own cancel()
    if (e.error === 'interrupted' || e.error === 'canceled') return
    if (e.error === 'not-allowed' || e.error === 'audio-busy' || e.error === 'synthesis-failed') {
      ttsStop()
      return
    }
    speakFrom(i + 1)
  }
  speechSynthesis.speak(u)
}

function finish(): void {
  const done = onFinished
  onFinished = null
  stopKeepalive()
  emit({ ...IDLE, voicesVersion: state.voicesVersion })
  done?.()
}

export function ttsStart(blocks: string[], label: string, finished?: () => void): void {
  if (!ttsSupported) return
  session++
  speechSynthesis.cancel()
  chunks = toChunks(blocks)
  onFinished = finished ?? null
  if (chunks.length === 0) return
  emit({
    status: 'playing',
    index: 0,
    total: chunks.length,
    label,
    currentText: chunks[0].text,
    charsRemaining: charsFrom(0),
    block: chunks[0].block,
    charStart: chunks[0].start,
    charEnd: chunks[0].end,
  })
  startKeepalive()
  // a beat after cancel() avoids a WebKit race where the new queue is dropped
  const mySession = session
  window.setTimeout(() => {
    if (session === mySession && state.status === 'playing') speakFrom(0)
  }, 60)
}

let pausedAt = 0

export function ttsToggle(): void {
  if (!ttsSupported || state.status === 'idle') return
  if (state.status === 'playing') {
    speechSynthesis.pause()
    pausedAt = Date.now()
    emit({ status: 'paused' })
  } else if (Date.now() - pausedAt > 15000) {
    // engines silently kill long-paused utterances and resume() goes nowhere —
    // restart the current passage instead
    ttsSkip(0)
  } else {
    speechSynthesis.resume()
    emit({ status: 'playing' })
  }
}

/** Jump playback to the first passage of the given source block.
    Returns false when no speech session is active. */
export function ttsJumpToBlock(block: number): boolean {
  if (!ttsSupported || state.status === 'idle') return false
  const target = chunks.findIndex((c) => c.block === block)
  if (target < 0) return true
  session++
  const mySession = session
  speechSynthesis.cancel()
  emit({ status: 'playing' })
  window.setTimeout(() => {
    if (session === mySession) speakFrom(target)
  }, 60)
  return true
}

export function ttsSkip(delta: number): void {
  if (!ttsSupported || state.status === 'idle') return
  const target = Math.min(chunks.length - 1, Math.max(0, state.index + delta))
  session++
  const mySession = session
  speechSynthesis.cancel()
  emit({ status: 'playing' })
  window.setTimeout(() => {
    if (session === mySession) speakFrom(target)
  }, 60)
}

export function ttsStop(): void {
  if (!ttsSupported) return
  session++
  onFinished = null
  stopKeepalive()
  speechSynthesis.cancel()
  if (state.status !== 'idle') emit({ ...IDLE, voicesVersion: state.voicesVersion })
}

export function ttsSetRate(rate: number): void {
  updatePrefs({ ttsRate: rate })
  if (state.status === 'playing') ttsSkip(0) // restart current chunk at the new rate
}

export function ttsSetVoice(voiceURI: string | null): void {
  updatePrefs({ ttsVoice: voiceURI })
  if (state.status === 'playing') ttsSkip(0)
}
