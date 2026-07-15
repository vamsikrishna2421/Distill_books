import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AudioPlayer } from '../components/AudioPlayer'
import { abPlay, abStop, useAudiobook } from '../lib/audiobook'
import { getBook, hasChapterFile, loadChapter } from '../lib/content'
import { alignManifestToElements, collectSpeechTargets, useSpeechFollow } from '../lib/follow'
import { ttsStart, ttsStop, useTts } from '../lib/tts'
import {
  bumpFontScale,
  resolveReaderTheme,
  updatePrefs,
  usePrefs,
} from '../lib/prefs'
import { markChapterRead, setLastChapter, useBookProgress } from '../lib/progress'
import { mdInline } from '../lib/markdown'
import type { Chapter } from '../types'

type LoadState = 'loading' | 'ready' | 'missing'

export default function Reader() {
  const { bookId, num } = useParams()
  const n = parseInt(num ?? '1', 10)
  const navigate = useNavigate()
  const book = getBook(bookId)
  const prefs = usePrefs()
  const progress = useBookProgress(bookId ?? '')

  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [pct, setPct] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const autoplayRef = useRef(false)
  const articleRef = useRef<HTMLElement>(null)
  const speechElsRef = useRef<(HTMLElement | null)[]>([])
  const tts = useTts()
  const audiobook = useAudiobook()
  useSpeechFollow(speechElsRef)

  const SPEECH_SELECTOR =
    '.ch-title, .key-ideas h2, .key-ideas li, .ch-body p, .ch-body h2, .ch-body h3, .ch-body li, .ch-body blockquote, .in-practice h2, .in-practice li'

  async function startListening() {
    if (!book || state !== 'ready') return
    const targets = collectSpeechTargets(articleRef.current, SPEECH_SELECTOR)
    if (targets.texts.length === 0) return
    const num = n
    const label = `Ch ${num} · ${book.title}`
    const finished = () => {
      markChapterRead(book.id, num)
      const nextAvailable =
        book.map.chapters.some((c) => c.number === num + 1) && hasChapterFile(book.id, num + 1)
      if (nextAvailable) {
        autoplayRef.current = true
        navigate(`/book/${book.id}/read/${num + 1}`)
      }
    }
    // pre-generated narration first; Web Speech as fallback
    const manifest = await abPlay(book.id, `ch-${String(num).padStart(2, '0')}`, label, finished)
    if (manifest) {
      speechElsRef.current = alignManifestToElements(manifest.blocks, targets)
    } else {
      speechElsRef.current = [null, ...targets.elements] // spoken intro has no element
      ttsStart([`Chapter ${num}.`, ...targets.texts], label, finished)
    }
  }

  useEffect(() => {
    let alive = true
    setState('loading')
    setChapter(null)
    if (!autoplayRef.current) {
      ttsStop()
      abStop()
    }
    if (!bookId) return
    loadChapter(bookId, n)
      .then((ch) => {
        if (!alive) return
        if (ch) {
          setChapter(ch)
          setState('ready')
        } else {
          setState('missing')
        }
      })
      .catch(() => {
        if (alive) setState('missing')
      })
    return () => {
      alive = false
    }
  }, [bookId, n])

  // continue listening into the next chapter once its DOM has rendered
  useEffect(() => {
    if (state === 'ready' && autoplayRef.current) {
      autoplayRef.current = false
      const t = window.setTimeout(startListening, 150)
      return () => window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, n])

  useEffect(
    () => () => {
      ttsStop()
      abStop()
    },
    [],
  )

  useEffect(() => {
    if (bookId && book && state === 'ready' && book.map.chapters.some((c) => c.number === n)) {
      setLastChapter(bookId, n)
    }
  }, [bookId, n, book, state])

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      const max = el.scrollHeight - window.innerHeight
      setPct(max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 100)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [state])

  useEffect(() => {
    if (!book) return
    const total = book.map.chapters.length
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && n < total && hasChapterFile(book.id, n + 1)) {
        navigate(`/book/${book.id}/read/${n + 1}`)
      } else if (e.key === 'ArrowLeft' && n > 1 && hasChapterFile(book.id, n - 1)) {
        navigate(`/book/${book.id}/read/${n - 1}`)
      } else if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        else navigate(`/book/${book.id}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [book, n, navigate, showSettings])

  if (!book || Number.isNaN(n)) return <Navigate to="/" replace />

  const total = book.map.chapters.length
  const nextCh = book.map.chapters.find((c) => c.number === n + 1)
  const readerTheme = resolveReaderTheme(prefs)
  const isRead = progress.chaptersRead.includes(n)

  function finishChapter() {
    if (!book) return
    markChapterRead(book.id, n)
    if (nextCh && hasChapterFile(book.id, n + 1)) {
      navigate(`/book/${book.id}/read/${n + 1}`)
    } else {
      navigate(`/book/${book.id}`)
    }
  }

  return (
    <div
      className={
        tts.status !== 'idle' || audiobook.status !== 'idle' ? 'reader has-audio' : 'reader'
      }
      data-rtheme={readerTheme}
      style={
        {
          '--font-scale': prefs.fontScale,
          '--wscale': prefs.wide ? 1.22 : 1,
        } as CSSProperties
      }
    >
      <div className="rdr-progress" style={{ width: `${pct}%` }} aria-hidden="true" />

      <header className="rdr-top">
        <Link to={`/book/${book.id}`} className="rdr-back">
          ← Map
        </Link>
        <div className="rdr-mid">
          <span className="rdr-book">{book.title}</span>
          <span className="rdr-pos">
            Chapter {n} of {total}
            {isRead ? ' · read ✓' : ''}
          </span>
        </div>
        <div className="rdr-actions">
          {n > 1 && hasChapterFile(book.id, n - 1) ? (
            <Link className="rdr-nav" to={`/book/${book.id}/read/${n - 1}`} aria-label="Previous chapter">
              ←
            </Link>
          ) : (
            <span className="rdr-nav off" aria-hidden="true">
              ←
            </span>
          )}
          {n < total && hasChapterFile(book.id, n + 1) ? (
            <Link className="rdr-nav" to={`/book/${book.id}/read/${n + 1}`} aria-label="Next chapter">
              →
            </Link>
          ) : (
            <span className="rdr-nav off" aria-hidden="true">
              →
            </span>
          )}
          {state === 'ready' && chapter && (
            <button
              className={
                tts.status !== 'idle' || audiobook.status !== 'idle' ? 'rdr-aa on' : 'rdr-aa'
              }
              onClick={() => void startListening()}
              aria-label="Listen to this chapter"
              title="Listen"
            >
              🎧
            </button>
          )}
          <button
            className={showSettings ? 'rdr-aa on' : 'rdr-aa'}
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Reading settings"
          >
            Aa
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="rdr-settings" role="dialog" aria-label="Reading settings">
          <div className="rdr-set-row">
            <span>Text size</span>
            <div className="seg">
              <button onClick={() => bumpFontScale(-0.05)} aria-label="Smaller text">
                A−
              </button>
              <span className="seg-val">{Math.round(prefs.fontScale * 100)}%</span>
              <button onClick={() => bumpFontScale(0.05)} aria-label="Larger text">
                A+
              </button>
            </div>
          </div>
          <div className="rdr-set-row">
            <span>Theme</span>
            <div className="swatches">
              {(['paper', 'sepia', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  className={readerTheme === t ? `swatch sw-${t} on` : `swatch sw-${t}`}
                  onClick={() => updatePrefs({ readerTheme: t })}
                  aria-label={`${t} theme`}
                  title={t}
                />
              ))}
            </div>
          </div>
          <div className="rdr-set-row">
            <span>Width</span>
            <div className="seg">
              <button className={!prefs.wide ? 'on' : ''} onClick={() => updatePrefs({ wide: false })}>
                Narrow
              </button>
              <button className={prefs.wide ? 'on' : ''} onClick={() => updatePrefs({ wide: true })}>
                Wide
              </button>
            </div>
          </div>
        </div>
      )}

      {state === 'loading' && <div className="rdr-state">Loading…</div>}

      {state === 'missing' && (
        <div className="rdr-state">
          <h1>This chapter is still being distilled</h1>
          <p>Check back in a little while — it will appear here automatically.</p>
          <Link to={`/book/${book.id}`} className="btn btn-primary">
            Back to the map
          </Link>
        </div>
      )}

      {state === 'ready' && chapter && (
        <article className="rdr-page" ref={articleRef}>
          <p className="ch-kicker">
            Chapter {n} · {chapter.minutes} min
          </p>
          <h1 className="ch-title">{chapter.title}</h1>

          {chapter.keyIdeas.length > 0 && (
            <aside className="key-ideas">
              <h2>The ideas in 30 seconds</h2>
              <ul>
                {chapter.keyIdeas.map((k, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: mdInline(k) }} />
                ))}
              </ul>
            </aside>
          )}

          <div className="ch-body md" dangerouslySetInnerHTML={{ __html: chapter.bodyHtml }} />

          {chapter.inPractice.length > 0 && (
            <aside className="in-practice">
              <h2>In practice</h2>
              <ul>
                {chapter.inPractice.map((k, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: mdInline(k) }} />
                ))}
              </ul>
            </aside>
          )}

          <footer className="ch-end">
            <button className="btn btn-primary btn-big" onClick={finishChapter}>
              {nextCh && hasChapterFile(book.id, n + 1)
                ? `Done — next: ${nextCh.title}`
                : 'Done — back to the map'}
            </button>
            <Link to={`/book/${book.id}`} className="ch-end-back">
              Back to the map
            </Link>
          </footer>
        </article>
      )}

      <AudioPlayer />
    </div>
  )
}
