import type { MouseEvent } from 'react'
import {
  abSeek,
  abSeekTo,
  abSetRate,
  abStop,
  abToggle,
  useAudiobook,
} from '../lib/audiobook'
import { updatePrefs, usePrefs } from '../lib/prefs'
import {
  ttsSetRate,
  ttsSetVoice,
  ttsSkip,
  ttsStop,
  ttsToggle,
  useTts,
  voicesForUi,
} from '../lib/tts'

const RATES = [1, 1.25, 1.5, 2, 0.75]
const SPEECH_CHARS_PER_MIN = 900

const touchDevice =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Floating playback bar for both engines: pre-generated narration (seekable,
    lock-screen capable) and Web Speech fallback. Renders nothing while idle. */
export function AudioPlayer() {
  const tts = useTts()
  const ab = useAudiobook()
  const prefs = usePrefs()

  const abActive = ab.status !== 'idle'
  if (!abActive && tts.status === 'idle') return null

  const rate = prefs.ttsRate

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
    if (abActive) {
      updatePrefs({ ttsRate: next })
      abSetRate(next)
    } else {
      ttsSetRate(next)
    }
  }

  if (abActive) {
    const pct = ab.duration > 0 ? (ab.time / ab.duration) * 100 : 0
    function seekClick(e: MouseEvent<HTMLDivElement>) {
      const rect = e.currentTarget.getBoundingClientRect()
      abSeekTo(((e.clientX - rect.left) / rect.width) * ab.duration)
    }
    return (
      <div className="audio-player" role="region" aria-label="Narration controls">
        <div className="audio-seek" onClick={seekClick} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="audio-main">
          <button className="audio-btn" onClick={() => abSeek(-15)} aria-label="Back 15 seconds">
            ↺
          </button>
          <button
            className="audio-btn audio-play"
            onClick={abToggle}
            aria-label={ab.status === 'playing' ? 'Pause' : 'Play'}
          >
            {ab.status === 'playing' ? '❚❚' : '▶'}
          </button>
          <button className="audio-btn" onClick={() => abSeek(15)} aria-label="Forward 15 seconds">
            ↻
          </button>
          <div className="audio-info">
            <span className="audio-label">
              {ab.label} · read by {ab.narrator}
            </span>
            <span className="audio-text">
              {fmtTime(ab.time)} / {fmtTime(ab.duration)}
            </span>
          </div>
          <button className="audio-rate" onClick={cycleRate} aria-label={`Speed ${rate}x`}>
            {rate}×
          </button>
          <button className="audio-btn" onClick={abStop} aria-label="Stop narration">
            ✕
          </button>
        </div>
        {touchDevice && (
          <p className="audio-hint">
            Real narration — keeps playing with the screen locked. Control it from your lock
            screen.
          </p>
        )}
      </div>
    )
  }

  const minutesLeft = Math.max(1, Math.ceil(tts.charsRemaining / (SPEECH_CHARS_PER_MIN * rate)))
  const pct = tts.total > 0 ? (tts.index / tts.total) * 100 : 0

  return (
    <div className="audio-player" role="region" aria-label="Listening controls">
      <div className="audio-progress" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="audio-main">
        <button className="audio-btn" onClick={() => ttsSkip(-1)} aria-label="Back one passage">
          ⏮
        </button>
        <button
          className="audio-btn audio-play"
          onClick={ttsToggle}
          aria-label={tts.status === 'playing' ? 'Pause' : 'Play'}
        >
          {tts.status === 'playing' ? '❚❚' : '▶'}
        </button>
        <button className="audio-btn" onClick={() => ttsSkip(1)} aria-label="Forward one passage">
          ⏭
        </button>
        <div className="audio-info">
          <span className="audio-label">
            {tts.label} · ~{minutesLeft} min left
          </span>
          <span className="audio-text">{tts.currentText}</span>
        </div>
        <button className="audio-rate" onClick={cycleRate} aria-label={`Speed ${rate}x`}>
          {rate}×
        </button>
        <select
          className="audio-voice"
          value={prefs.ttsVoice ?? ''}
          onChange={(e) => ttsSetVoice(e.target.value || null)}
          aria-label="Voice"
        >
          <option value="">Default voice</option>
          {voicesForUi().map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}
            </option>
          ))}
        </select>
        <button className="audio-btn" onClick={ttsStop} aria-label="Stop listening">
          ✕
        </button>
      </div>
      {touchDevice && (
        <p className="audio-hint">
          Keep the screen on — browser speech pauses if it locks. Better voices: download
          Enhanced/Siri voices in Settings → Accessibility → Spoken Content → Voices, then pick one
          here.
        </p>
      )}
    </div>
  )
}
