import { usePrefs } from '../lib/prefs'
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

/** Floating playback bar. Renders nothing while idle; inherits the reader's
    theme variables when mounted inside .reader, app variables elsewhere. */
export function AudioPlayer() {
  const s = useTts()
  const prefs = usePrefs()
  if (s.status === 'idle') return null

  const rate = prefs.ttsRate
  const minutesLeft = Math.max(1, Math.ceil(s.charsRemaining / (SPEECH_CHARS_PER_MIN * rate)))
  const pct = s.total > 0 ? (s.index / s.total) * 100 : 0

  function cycleRate() {
    const i = RATES.indexOf(rate)
    ttsSetRate(RATES[(i + 1) % RATES.length])
  }

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
          aria-label={s.status === 'playing' ? 'Pause' : 'Play'}
        >
          {s.status === 'playing' ? '❚❚' : '▶'}
        </button>
        <button className="audio-btn" onClick={() => ttsSkip(1)} aria-label="Forward one passage">
          ⏭
        </button>
        <div className="audio-info">
          <span className="audio-label">
            {s.label} · ~{minutesLeft} min left
          </span>
          <span className="audio-text">{s.currentText}</span>
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
