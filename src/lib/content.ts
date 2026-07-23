import type { Book, BookStats, Category, Chapter } from '../types'
import rawCategories from '../content/categories.json'
import { mdInline, mdToHtml } from './markdown'

// ---------------------------------------------------------------------------
// Content discovery — books are plain files under src/content/books/<id>/
// book.json holds metadata + the Stage-1 map; chapters/NN.md are Stage-2 text.
// ---------------------------------------------------------------------------

const bookModules = import.meta.glob('../content/books/*/book.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const chapterModules = import.meta.glob('../content/books/*/chapters/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const storyModules = import.meta.glob('../content/books/*/stories/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export const categories: Category[] = [...(rawCategories as Category[])].sort(
  (a, b) => a.order - b.order,
)

const catOrder = new Map(categories.map((c) => [c.id, c.order]))

function isBook(x: unknown): x is Book {
  if (!x || typeof x !== 'object') return false
  const b = x as Book
  return (
    typeof b.id === 'string' &&
    typeof b.title === 'string' &&
    typeof b.author === 'string' &&
    typeof b.originalPages === 'number' &&
    !!b.map &&
    typeof b.map.intro === 'string' &&
    Array.isArray(b.map.chapters) &&
    b.map.chapters.length > 0 &&
    b.map.chapters.every(
      (c) =>
        !!c &&
        typeof c.number === 'number' &&
        typeof c.title === 'string' &&
        typeof c.summary === 'string',
    )
  )
}

export const books: Book[] = Object.entries(bookModules)
  .map(([path, data]) => {
    if (isBook(data)) return data
    console.warn(`Distill: skipping invalid book file ${path}`)
    return null
  })
  .filter((b): b is Book => b !== null)
  .sort(
    (a, b) =>
      (catOrder.get(a.categoryId) ?? 99) - (catOrder.get(b.categoryId) ?? 99) ||
      a.syllabusOrder - b.syllabusOrder,
  )

export function getBook(id: string | undefined): Book | undefined {
  return books.find((b) => b.id === id)
}

export function booksInCategory(categoryId: string): Book[] {
  return books.filter((b) => b.categoryId === categoryId)
}

export function categoryOf(book: Book): Category | undefined {
  return categories.find((c) => c.id === book.categoryId)
}

// ---------------------------------------------------------------------------
// Chapter files
// ---------------------------------------------------------------------------

const chapterIndex = new Map<string, Map<number, () => Promise<string>>>()
for (const [path, loader] of Object.entries(chapterModules)) {
  const m = path.match(/books\/([^/]+)\/chapters\/(\d+)\.md$/)
  if (!m) continue
  const bookId = m[1]
  const num = parseInt(m[2], 10)
  if (!chapterIndex.has(bookId)) chapterIndex.set(bookId, new Map())
  chapterIndex.get(bookId)!.set(num, loader)
}

export function hasChapterFile(bookId: string, n: number): boolean {
  return chapterIndex.get(bookId)?.has(n) ?? false
}

const storyIndex = new Map<string, Map<number, () => Promise<string>>>()
for (const [path, loader] of Object.entries(storyModules)) {
  const m = path.match(/books\/([^/]+)\/stories\/(\d+)\.md$/)
  if (!m) continue
  const bookId = m[1]
  const num = parseInt(m[2], 10)
  if (!storyIndex.has(bookId)) storyIndex.set(bookId, new Map())
  storyIndex.get(bookId)!.set(num, loader)
}

export function hasStoryFile(bookId: string, n: number): boolean {
  return storyIndex.get(bookId)?.has(n) ?? false
}

export function countWords(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

function extractBullets(block: string): string[] {
  return block
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
}

/**
 * Chapter markdown contract: "# Title" first, then "## " sections.
 * "## Key Ideas" and "## In Practice" are pulled out and styled separately;
 * everything else renders in order as the body. Missing markers degrade
 * gracefully — the content just stays in the body.
 */
export async function loadChapter(bookId: string, n: number): Promise<Chapter | null> {
  const loader = chapterIndex.get(bookId)?.get(n)
  if (!loader) return null
  const raw = await loader()

  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : `Chapter ${n}`
  const afterTitle = titleMatch
    ? raw.slice(raw.indexOf(titleMatch[0]) + titleMatch[0].length)
    : raw

  let keyIdeas: string[] = []
  let inPractice: string[] = []
  const body: string[] = []

  for (const block of afterTitle.split(/\n(?=##\s)/)) {
    const heading = block.match(/^##\s+(.+)$/m)?.[1]?.trim().toLowerCase() ?? ''
    if (heading.startsWith('key ideas')) keyIdeas = extractBullets(block)
    else if (heading.startsWith('in practice')) inPractice = extractBullets(block)
    else if (block.trim()) body.push(block)
  }

  const bodyMd = body.join('\n')
  const words =
    countWords(bodyMd) + countWords(keyIdeas.join(' ')) + countWords(inPractice.join(' '))

  return {
    number: n,
    title,
    words,
    minutes: Math.max(3, Math.round(words / 220)),
    keyIdeas,
    bodyHtml: mdToHtml(bodyMd),
    inPractice,
  }
}

/**
 * Story markdown contract: "# Title" first, then free markdown, plus optional
 * guess-before-reveal blocks:
 *
 *   ::: guess
 *   {question, markdown}
 *   ---
 *   {answer, markdown}
 *   :::
 *
 * Rendered as a <details class="reveal"> the reader taps to reveal. The
 * summary text is exactly "Pause and guess: {question}" so pre-generated
 * narration manifests align to it.
 */
const GUESS_RE = /^:::\s*guess\s*\n([\s\S]*?)\n---\n([\s\S]*?)\n:::\s*$/gm

export async function loadStory(bookId: string, n: number): Promise<Chapter | null> {
  const loader = storyIndex.get(bookId)?.get(n)
  if (!loader) return null
  const raw = await loader()

  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : `Chapter ${n}`
  const body = titleMatch
    ? raw.slice(raw.indexOf(titleMatch[0]) + titleMatch[0].length)
    : raw

  const parts: string[] = []
  let cursor = 0
  for (const m of body.matchAll(GUESS_RE)) {
    parts.push(mdToHtml(body.slice(cursor, m.index)))
    const question = m[1].trim().replace(/\s+/g, ' ')
    parts.push(
      `<details class="reveal"><summary>Pause and guess: ${mdInline(question)}</summary>` +
        `<div class="reveal-a">${mdToHtml(m[2].trim())}</div></details>`,
    )
    cursor = (m.index ?? 0) + m[0].length
  }
  parts.push(mdToHtml(body.slice(cursor)))

  const words = countWords(body.replace(GUESS_RE, (_, q, a) => `${q} ${a}`))
  return {
    number: n,
    title,
    words,
    minutes: Math.max(3, Math.round(words / 220)),
    keyIdeas: [],
    bodyHtml: parts.join('\n'),
    inPractice: [],
  }
}

// ---------------------------------------------------------------------------
// Stats & search
// ---------------------------------------------------------------------------

const AVG_WPM = 220 // distilled prose reading speed
const ORIGINAL_MIN_PER_PAGE = 1.6 // typical trade-book page

export function bookStats(b: Book): BookStats {
  const mapWords =
    countWords(b.map.intro) + b.map.chapters.reduce((n, c) => n + countWords(c.summary), 0)
  const mapMinutes = Math.max(4, Math.round(mapWords / AVG_WPM))
  const deepMinutes = b.map.chapters.reduce((n, c) => n + (c.minutes || 9), 0)
  const totalMinutes = mapMinutes + deepMinutes
  const distilledPages = Math.max(3, Math.round((totalMinutes * AVG_WPM) / 300))
  const originalMinutes = Math.round(b.originalPages * ORIGINAL_MIN_PER_PAGE)
  const savedPct = Math.max(0, Math.round(100 * (1 - totalMinutes / originalMinutes)))
  return { mapMinutes, deepMinutes, totalMinutes, distilledPages, originalMinutes, savedPct }
}

export function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} m` : `${h} h`
}

/** Squash transliteration variants so "niti" finds "Neeti", "gita" finds
    "Geeta", etc. — collapse doubled vowels and drop the rest. */
function squash(s: string): string {
  return s
    .toLowerCase()
    .replace(/ee/g, 'i')
    .replace(/aa/g, 'a')
    .replace(/oo/g, 'u')
    .replace(/[^a-z0-9\s]/g, '')
}

export function searchBooks(query: string): Book[] {
  const q = query.trim().toLowerCase()
  if (!q) return books
  const terms = q.split(/\s+/)
  return books
    .map((b) => {
      const strong = `${b.title} ${b.author}`.toLowerCase()
      const mid = `${b.tagline} ${categoryOf(b)?.name ?? ''}`.toLowerCase()
      const weak = b.map.chapters.map((c) => c.title).join(' ').toLowerCase()
      const strongSq = squash(strong)
      let score = 0
      for (const t of terms) {
        if (strong.includes(t)) score += 5
        else if (strongSq.includes(squash(t))) score += 4
        if (mid.includes(t)) score += 2
        if (weak.includes(t)) score += 1
      }
      return { b, score }
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.b)
}
