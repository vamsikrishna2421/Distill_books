import { useSyncExternalStore } from 'react'
import { getPrefs } from './prefs'

// ---------------------------------------------------------------------------
// Pre-generated narration playback. Audio files are hosted separately (GitHub
// Releases); per-block timestamp manifests ship with the app under
// /audio-manifests. Falls back cleanly: callers get null when no narration
// exists and use the Web Speech engine instead.
// ---------------------------------------------------------------------------

export interface ManifestBlock {
  t: number
  text: string
}

export interface AudioManifest {
  voice: string
  narrator: string
  duration: number
  blocks: ManifestBlock[]
}

export interface AudiobookState {
  status: 'idle' | 'playing' | 'paused'
  label: string
  narrator: string
  duration: number
  time: number
  block: number
}

const AUDIO_BASE = import.meta.env.DEV
  ? '/audio'
  : 'https://github.com/vamsikrishna2421/Distill_books/releases/download/audio-v1'

const IDLE: AudiobookState = {
  status: 'idle',
  label: '',
  narrator: '',
  duration: 0,
  time: 0,
  block: 0,
}

let state: AudiobookState = IDLE
const listeners = new Set<() => void>()

function emit(patch: Partial<AudiobookState>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useAudiobook(): AudiobookState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

let audio: HTMLAudioElement | null = null
let manifest: AudioManifest | null = null
let onFinished: (() => void) | null = null

function blockAt(time: number): number {
  if (!manifest) return 0
  let b = 0
  for (let i = 0; i < manifest.blocks.length; i++) {
    if (manifest.blocks[i].t <= time + 0.05) b = i
    else break
  }
  return b
}

async function fetchManifest(bookId: string, item: string): Promise<AudioManifest | null> {
  try {
    const res = await fetch(`/audio-manifests/${bookId}/${item}.json`)
    if (!res.ok) return null
    // SPA rewrites serve index.html for missing files — never a JSON manifest
    if ((res.headers.get('content-type') ?? '').includes('text/html')) return null
    const m = (await res.json()) as AudioManifest
    return Array.isArray(m.blocks) && m.blocks.length > 0 ? m : null
  } catch {
    return null
  }
}

function setupMediaSession(label: string, narrator: string): void {
  if (!('mediaSession' in navigator)) return
  const ms = navigator.mediaSession
  ms.metadata = new MediaMetadata({
    title: label,
    artist: `Distill · read by ${narrator}`,
    album: 'Distill',
  })
  ms.setActionHandler('play', () => abToggle())
  ms.setActionHandler('pause', () => abToggle())
  ms.setActionHandler('seekbackward', () => abSeek(-15))
  ms.setActionHandler('seekforward', () => abSeek(15))
  ms.setActionHandler('stop', () => abStop())
}

/** Start narration playback. Resolves with the manifest on success, or null
    (nothing generated / fetch failed / playback blocked) so the caller can
    fall back to Web Speech. */
export async function abPlay(
  bookId: string,
  item: string,
  label: string,
  finished?: () => void,
): Promise<AudioManifest | null> {
  abStop()
  const m = await fetchManifest(bookId, item)
  if (!m) return null

  manifest = m
  onFinished = finished ?? null
  const el = new Audio(`${AUDIO_BASE}/${bookId}--${item}.m4a`)
  audio = el
  el.preload = 'auto'
  el.playbackRate = getPrefs().ttsRate

  el.addEventListener('timeupdate', () => {
    if (audio === el) emit({ time: el.currentTime, block: blockAt(el.currentTime) })
  })
  el.addEventListener('play', () => {
    if (audio === el) emit({ status: 'playing' })
  })
  el.addEventListener('pause', () => {
    if (audio === el && state.status !== 'idle' && !el.ended) emit({ status: 'paused' })
  })
  el.addEventListener('ended', () => {
    if (audio === el) {
      const done = onFinished
      abStop()
      done?.()
    }
  })
  el.addEventListener('error', () => {
    if (audio === el) abStop()
  })

  emit({ status: 'playing', label, narrator: m.narrator, duration: m.duration, time: 0, block: 0 })
  try {
    await el.play()
  } catch {
    abStop()
    return null
  }
  setupMediaSession(label, m.narrator)
  return m
}

export function abToggle(): void {
  if (!audio || state.status === 'idle') return
  if (audio.paused) void audio.play()
  else audio.pause()
}

export function abSeek(deltaSec: number): void {
  if (!audio || state.status === 'idle') return
  audio.currentTime = Math.min(
    Math.max(0, audio.currentTime + deltaSec),
    manifest?.duration ?? audio.duration ?? 0,
  )
}

export function abSeekTo(sec: number): void {
  if (!audio || state.status === 'idle') return
  audio.currentTime = Math.min(Math.max(0, sec), manifest?.duration ?? audio.duration ?? 0)
}

export function abSetRate(rate: number): void {
  if (audio) audio.playbackRate = rate
}

/** Jump playback to the start of a manifest block (resumes if paused).
    Returns false when no narration session is active. */
export function abJumpToBlock(block: number): boolean {
  if (!audio || !manifest || state.status === 'idle') return false
  const b = manifest.blocks[block]
  if (!b) return true
  audio.currentTime = b.t + 0.01
  if (audio.paused) void audio.play()
  return true
}

export function abStop(): void {
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    audio = null
  }
  manifest = null
  onFinished = null
  if (state.status !== 'idle') emit(IDLE)
}
