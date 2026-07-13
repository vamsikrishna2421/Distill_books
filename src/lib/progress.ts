import { createLocalStore, useStore } from './store'

export interface BookProgress {
  mapRead: boolean
  chaptersRead: number[]
  lastChapter?: number
  updatedAt: number
}

export type ProgressState = Record<string, BookProgress>

export const EMPTY_PROGRESS: BookProgress = { mapRead: false, chaptersRead: [], updatedAt: 0 }

const store = createLocalStore<ProgressState>('distill.progress.v1', {})

/**
 * localStorage survives schema drift, hand edits, and partial writes — never
 * trust a stored entry's shape. Every read path funnels through here.
 */
function sanitize(p: unknown): BookProgress {
  if (!p || typeof p !== 'object') return EMPTY_PROGRESS
  const raw = p as Partial<BookProgress>
  const chaptersRead = Array.isArray(raw.chaptersRead)
    ? [...new Set(raw.chaptersRead.filter((x): x is number => typeof x === 'number'))].sort(
        (a, b) => a - b,
      )
    : []
  return {
    mapRead: raw.mapRead === true,
    chaptersRead,
    lastChapter: typeof raw.lastChapter === 'number' ? raw.lastChapter : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

export function useAllProgress(): ProgressState {
  return useStore(store)
}

export function useBookProgress(bookId: string): BookProgress {
  const all = useStore(store)
  return sanitize(all[bookId])
}

function update(bookId: string, patch: Partial<BookProgress>): void {
  store.set((s) => ({
    ...s,
    [bookId]: { ...sanitize(s[bookId]), ...patch, updatedAt: Date.now() },
  }))
}

export function markMapRead(bookId: string, read = true): void {
  update(bookId, { mapRead: read })
}

export function markChapterRead(bookId: string, n: number): void {
  store.set((s) => {
    const cur = sanitize(s[bookId])
    const chaptersRead = cur.chaptersRead.includes(n)
      ? cur.chaptersRead
      : [...cur.chaptersRead, n].sort((a, b) => a - b)
    return { ...s, [bookId]: { ...cur, chaptersRead, lastChapter: n, updatedAt: Date.now() } }
  })
}

export function toggleChapterRead(bookId: string, n: number): void {
  store.set((s) => {
    const cur = sanitize(s[bookId])
    const has = cur.chaptersRead.includes(n)
    const chaptersRead = has
      ? cur.chaptersRead.filter((x) => x !== n)
      : [...cur.chaptersRead, n].sort((a, b) => a - b)
    return { ...s, [bookId]: { ...cur, chaptersRead, updatedAt: Date.now() } }
  })
}

export function setLastChapter(bookId: string, n: number): void {
  update(bookId, { lastChapter: n })
}

/** Percent complete, counting the map as one unit alongside the chapters. */
export function completionPct(totalChapters: number, p: BookProgress): number {
  const read = Array.isArray(p.chaptersRead) ? new Set(p.chaptersRead).size : 0
  const units = totalChapters + 1
  const done = (p.mapRead ? 1 : 0) + Math.min(read, totalChapters)
  return Math.round((100 * done) / units)
}

/** The most recently touched book, for the "continue reading" strip. */
export function latestProgress(all: ProgressState): { bookId: string; progress: BookProgress } | null {
  let best: { bookId: string; progress: BookProgress } | null = null
  for (const [bookId, raw] of Object.entries(all)) {
    const progress = sanitize(raw)
    if (progress.updatedAt > 0 && (!best || progress.updatedAt > best.progress.updatedAt)) {
      best = { bookId, progress }
    }
  }
  return best
}
