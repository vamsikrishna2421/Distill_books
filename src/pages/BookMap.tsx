import { useEffect, useRef } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { Cover } from '../components/Cover'
import { AudioPlayer } from '../components/AudioPlayer'
import { Markdown } from '../lib/markdown'
import { collectSpeechTargets, useSpeechFollow } from '../lib/follow'
import { ttsStart, ttsStop, ttsSupported, useTts } from '../lib/tts'
import {
  bookStats,
  booksInCategory,
  categoryOf,
  fmtDuration,
  getBook,
  hasChapterFile,
} from '../lib/content'
import { completionPct, markMapRead, toggleChapterRead, useBookProgress } from '../lib/progress'
import type { MapChapter } from '../types'

const DIFF_LABEL: Record<number, string> = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' }

function MapChapterCard({
  bookId,
  chapter,
  read,
  available,
}: {
  bookId: string
  chapter: MapChapter
  read: boolean
  available: boolean
}) {
  return (
    <article className={read ? 'map-ch is-read' : 'map-ch'}>
      <header className="map-ch-head">
        <span className="map-ch-num">{read ? '✓' : chapter.number}</span>
        <div className="map-ch-titles">
          <h3>{chapter.title}</h3>
          <span className="map-ch-min">{chapter.minutes} min deep read</span>
        </div>
      </header>
      <Markdown text={chapter.summary} className="map-ch-summary" />
      {chapter.readIf?.length > 0 && (
        <div className="readif">
          <span className="readif-label">Go deeper if</span>
          {chapter.readIf.map((r) => (
            <span className="chip" key={r}>
              {r}
            </span>
          ))}
        </div>
      )}
      <footer className="map-ch-foot">
        {available ? (
          <Link className="btn btn-primary" to={`/book/${bookId}/read/${chapter.number}`}>
            Read the full chapter · {chapter.minutes} min
          </Link>
        ) : (
          <span className="distilling">Being distilled — check back shortly</span>
        )}
        <button
          className={read ? 'btn btn-ghost is-on' : 'btn btn-ghost'}
          onClick={() => toggleChapterRead(bookId, chapter.number)}
          title="Mark as covered — the map told you enough"
        >
          {read ? 'Covered ✓' : 'Map was enough'}
        </button>
      </footer>
    </article>
  )
}

export default function BookMap() {
  const { bookId } = useParams()
  const book = getBook(bookId)
  const progress = useBookProgress(bookId ?? '')
  const tts = useTts()
  const mapRef = useRef<HTMLElement>(null)
  const speechElsRef = useRef<(HTMLElement | null)[]>([])
  useSpeechFollow(speechElsRef)
  useEffect(() => () => ttsStop(), [])
  if (!book) return <Navigate to="/" replace />

  const MAP_SPEECH_SELECTOR =
    '.map-intro p, .map-intro li, .map-howto p, .map-ch h3, .map-ch-summary p, .map-ch-summary li'

  function startMapListening() {
    if (!book) return
    const { texts, elements } = collectSpeechTargets(mapRef.current, MAP_SPEECH_SELECTOR)
    if (texts.length === 0) return
    speechElsRef.current = [null, ...elements, null] // spoken intro/outro have no element
    ttsStart(
      [
        `${book.title}, by ${book.author}. The book map.`,
        ...texts,
        'End of the map. Pick the chapters that earn your time.',
      ],
      `The Map · ${book.title}`,
      () => markMapRead(book.id),
    )
  }

  const stats = bookStats(book)
  const category = categoryOf(book)
  const total = book.map.chapters.length
  const pct = completionPct(total, progress)
  const siblings = booksInCategory(book.categoryId)
  const nextBook = siblings.find((b) => b.syllabusOrder === book.syllabusOrder + 1)

  return (
    <>
      <NavBar>
        <span className="nav-crumb">
          <Link to="/">Library</Link> / {category?.name ?? ''}
        </span>
      </NavBar>
      <main className={tts.status !== 'idle' ? 'bookpage wrap has-audio' : 'bookpage wrap'}>
        <header className="book-head">
          <Cover book={book} className="book-head-cover" />
          <div className="book-head-info">
            <p className="book-head-chips">
              <span className="chip chip-cat">{category?.name}</span>
              <span className="chip">{DIFF_LABEL[book.difficulty]}</span>
              {pct > 0 && <span className="chip chip-progress">{pct}% complete</span>}
            </p>
            <h1>{book.title}</h1>
            {book.subtitle && <p className="book-head-subtitle">{book.subtitle}</p>}
            <p className="book-head-byline">
              {book.author} · {book.year < 0 ? `c. ${-book.year} BCE` : book.year} ·{' '}
              {book.originalPages} pages in the original
            </p>
            <p className="book-head-tagline">{book.tagline}</p>
            <p className="book-head-why">{book.whyRead}</p>
          </div>
        </header>

        <section className="statbar" aria-label="Reading time comparison">
          <div className="stat">
            <span className="stat-label">The original</span>
            <strong>{book.originalPages} pages</strong>
            <span className="stat-sub">≈ {fmtDuration(stats.originalMinutes)}</span>
          </div>
          <div className="stat stat-accent">
            <span className="stat-label">Distilled</span>
            <strong>≈ {stats.distilledPages} pages</strong>
            <span className="stat-sub">{fmtDuration(stats.totalMinutes)} for everything</span>
          </div>
          <div className="stat">
            <span className="stat-label">You save</span>
            <strong>{stats.savedPct}% of the time</strong>
            <span className="stat-sub">and keep the ideas</span>
          </div>
        </section>

        <section className="howto">
          <div className={progress.mapRead ? 'howto-step done' : 'howto-step active'}>
            <span className="howto-num">{progress.mapRead ? '✓' : '1'}</span>
            <div>
              <strong>Read the map below</strong> · {stats.mapMinutes} min
              <p>Every chapter summarized. Decide what deserves your attention.</p>
            </div>
          </div>
          <div className={progress.mapRead ? 'howto-step active' : 'howto-step'}>
            <span className="howto-num">2</span>
            <div>
              <strong>Go deep on the chapters that matter</strong> · ~
              {Math.round(stats.deepMinutes / total)} min each
              <p>Distilled chapters keep every idea and cut the filler. Skip the rest guilt-free.</p>
            </div>
          </div>
        </section>

        <section className="map" ref={mapRef}>
          <h2 className="map-title">
            The Map <span className="map-min">{stats.mapMinutes} min read</span>
            {ttsSupported && (
              <button className="btn btn-ghost map-listen" onClick={startMapListening}>
                🎧 Listen
              </button>
            )}
          </h2>
          <Markdown text={book.map.intro} className="map-intro" />
          {book.map.howToUse && (
            <aside className="map-howto">
              <span>How to choose</span>
              <Markdown text={book.map.howToUse} />
            </aside>
          )}

          <div className="map-list">
            {book.map.chapters.map((c) => (
              <MapChapterCard
                key={c.number}
                bookId={book.id}
                chapter={c}
                read={progress.chaptersRead.includes(c.number)}
                available={hasChapterFile(book.id, c.number)}
              />
            ))}
          </div>

          <div className="map-done">
            {progress.mapRead ? (
              <p className="map-done-msg">
                Map read ✓ — now go deep where it counts. {progress.chaptersRead.length}/{total}{' '}
                chapters covered.
              </p>
            ) : (
              <>
                <p>Finished the map? You now know this book's shape.</p>
                <button className="btn btn-primary" onClick={() => markMapRead(book.id)}>
                  Mark the map as read
                </button>
              </>
            )}
          </div>
        </section>

        {nextBook && (
          <Link to={`/book/${nextBook.id}`} className="next-book">
            <div>
              <span className="next-book-kicker">Next in {category?.name}</span>
              <strong>{nextBook.title}</strong>
              <span className="next-book-author">{nextBook.author}</span>
            </div>
            <Cover book={nextBook} className="next-book-cover" />
          </Link>
        )}

        <AudioPlayer />
      </main>
    </>
  )
}
