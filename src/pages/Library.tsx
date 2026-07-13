import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { Cover } from '../components/Cover'
import {
  books,
  booksInCategory,
  bookStats,
  categories,
  fmtDuration,
  getBook,
  searchBooks,
} from '../lib/content'
import { completionPct, latestProgress, useAllProgress } from '../lib/progress'
import type { Book } from '../types'

const DIFF_LABEL: Record<number, string> = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' }

function Difficulty({ level }: { level: number }) {
  return (
    <span className="diff" title={DIFF_LABEL[level]}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= level ? 'on' : ''} />
      ))}
    </span>
  )
}

function BookCard({ book, step }: { book: Book; step?: number }) {
  const all = useAllProgress()
  const progress = all[book.id]
  const stats = bookStats(book)
  const pct = progress ? completionPct(book.map.chapters.length, progress) : 0
  return (
    <Link to={`/book/${book.id}`} className="book-card">
      <div className="book-card-coverwrap">
        <Cover book={book} />
        {step !== undefined && <span className="book-card-step">{String(step).padStart(2, '0')}</span>}
        {pct === 100 && <span className="book-card-done">✓ Finished</span>}
      </div>
      <h3 className="book-card-title">{book.title}</h3>
      <p className="book-card-author">{book.author}</p>
      <p className="book-card-meta">
        <Difficulty level={book.difficulty} />
        <span>{DIFF_LABEL[book.difficulty]}</span>
        <span className="dot">·</span>
        <span>{fmtDuration(stats.totalMinutes)}</span>
      </p>
      {pct > 0 && pct < 100 && (
        <div className="mini-progress" aria-label={`${pct}% complete`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </Link>
  )
}

function ContinueStrip() {
  const all = useAllProgress()
  const latest = latestProgress(all)
  if (!latest) return null
  const book = getBook(latest.bookId)
  if (!book) return null
  const p = latest.progress
  const total = book.map.chapters.length
  const pct = completionPct(total, p)
  if (pct >= 100) return null
  const nextUnread = book.map.chapters.find((c) => !p.chaptersRead.includes(c.number))
  const target = p.lastChapter && !p.chaptersRead.includes(p.lastChapter)
    ? p.lastChapter
    : nextUnread?.number
  const to = p.mapRead && target ? `/book/${book.id}/read/${target}` : `/book/${book.id}`
  const label = p.mapRead && target
    ? `Chapter ${target} · ${book.map.chapters.find((c) => c.number === target)?.title ?? ''}`
    : 'Pick up the map'
  return (
    <Link to={to} className="continue-strip">
      <Cover book={book} className="continue-cover" />
      <div className="continue-info">
        <span className="continue-kicker">Continue reading</span>
        <strong>{book.title}</strong>
        <span className="continue-next">{label}</span>
      </div>
      <div className="continue-right">
        <span className="continue-pct">{pct}%</span>
        <span className="continue-arrow">→</span>
      </div>
    </Link>
  )
}

export default function Library() {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchBooks(query), [query])
  const searching = query.trim().length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const totals = useMemo(() => {
    const pages = books.reduce((n, b) => n + b.originalPages, 0)
    const minutes = books.reduce((n, b) => n + bookStats(b).totalMinutes, 0)
    return { pages, minutes }
  }, [])

  return (
    <>
      <NavBar />
      <main className="library wrap">
        <section className="hero">
          <h1>
            Whole books.
            <br />
            <em>A fraction of the time.</em>
          </h1>
          <p className="hero-sub">
            Every book here is compressed twice. First, a short <strong>map</strong> tells you what
            each chapter argues — so you know where to go deep before spending a minute. Then each
            chapter is rebuilt straight to the point: every idea, study, and framework kept; the
            filler cut.
          </p>
          <div className="hero-steps">
            <div className="hero-step">
              <span className="hero-step-num">1</span>
              <div>
                <strong>Read the map</strong>
                <p>~10 minutes. Chapter-by-chapter summaries of the whole book.</p>
              </div>
            </div>
            <span className="hero-step-arrow">→</span>
            <div className="hero-step">
              <span className="hero-step-num">2</span>
              <div>
                <strong>Go deep where it matters</strong>
                <p>Distilled chapters, ~10 minutes each. You choose which ones.</p>
              </div>
            </div>
          </div>
          {books.length > 0 && (
            <p className="hero-stats">
              {books.length} books · {totals.pages.toLocaleString()} original pages, distilled into
              about {fmtDuration(totals.minutes)} of reading · four tracks that read like a syllabus
            </p>
          )}
        </section>

        <div className="searchbar">
          <span className="searchbar-icon">⌕</span>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search books, authors, chapters…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search books"
          />
          <kbd>/</kbd>
        </div>

        {!searching && <ContinueStrip />}

        {books.length === 0 && (
          <section className="empty-library">
            <h2>Your library is being distilled…</h2>
            <p>
              The bookshelf is empty right now. Book maps and chapters appear here automatically as
              they are generated — keep this page open and refresh in a minute.
            </p>
          </section>
        )}

        {searching ? (
          <section className="track">
            <header className="track-head">
              <h2>
                {results.length === 0
                  ? 'No matches'
                  : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`}
              </h2>
              {results.length === 0 && <p>Try an author, a topic, or a chapter title.</p>}
            </header>
            <div className="track-grid">
              {results.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
          </section>
        ) : (
          categories.map((cat, i) => {
            const list = booksInCategory(cat.id)
            if (list.length === 0) return null
            return (
              <section className="track" key={cat.id}>
                <header className="track-head">
                  <span className="track-kicker">
                    Track {String(i + 1).padStart(2, '0')} · {list.length}{' '}
                    {list.length === 1 ? 'book' : 'books'}
                  </span>
                  <h2>{cat.name}</h2>
                  <p>{cat.description}</p>
                </header>
                <div className="track-grid">
                  {list.map((b, j) => (
                    <BookCard key={b.id} book={b} step={j + 1} />
                  ))}
                </div>
              </section>
            )
          })
        )}

        <footer className="library-foot">
          <p>
            Every text on Distill is an original condensation written for learning — ideas,
            frameworks, and studies restated in our own words. Reading times assume ~220 words per
            minute. If a book earns it, buy the original.
          </p>
        </footer>
      </main>
    </>
  )
}
