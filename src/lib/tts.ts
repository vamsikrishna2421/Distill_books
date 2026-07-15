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

export function voicesForUi(): SpeechSynthesisVoice[] {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  return en.length ? en : voices
}

function pickVoice(): SpeechSynthesisVoice | null {
  const wanted = getPrefs().ttsVoice
  if (wanted) {
    const match = voices.find((v) => v.voiceURI === wanted)
    if (match) return match
  }
  const en = voicesForUi()
  return en.find((v) => v.default) ?? en[0] ?? null
}

// --- Chunking ---------------------------------------------------------------

interface Chunk {
  text: string
  block: number
  start: number
  end: number
}

function toChunks(blocks: string[]): Chunk[] {
  const out: Chunk[] = []
  const push = (block: number, raw: string, rawStart: number) => {
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text) out.push({ text, block, start: rawStart + lead, end: rawStart + lead + text.length })
  }
  blocks.forEach((rawBlock, b) => {
    const text = rawBlock.replace(/\s+/g, ' ').trim()
    if (!text) return
    const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text]
    let cur = ''
    let curStart = 0
    let pos = 0
    for (const s of sentences) {
      if (cur && (cur + s).length > 230) {
        push(b, cur, curStart)
        cur = s
        curStart = pos
      } else {
        if (!cur) curStart = pos
        cur += s
      }
      pos += s.length
    }
    push(b, cur, curStart)
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
  emit({
    index: i,
    currentText: c.text,
    charsRemaining: charsFrom(i),
    block: c.block,
    charStart: c.start,
    charEnd: c.end,
  })
  const u = new SpeechSynthesisUtterance(c.text)
  u.rate = getPrefs().ttsRate
  const voice = pickVoice()
  if (voice) u.voice = voice
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

export function ttsToggle(): void {
  if (!ttsSupported || state.status === 'idle') return
  if (state.status === 'playing') {
    speechSynthesis.pause()
    emit({ status: 'paused' })
  } else {
    speechSynthesis.resume()
    emit({ status: 'playing' })
  }
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
