import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { useTts } from './tts'

// ---------------------------------------------------------------------------
// Follow-along for TTS playback: the page collects its speakable elements in
// document order (so spoken block i IS element i), then useSpeechFollow keeps
// the current paragraph in view and paints the current sentence via the CSS
// Custom Highlight API (block-level highlight is the fallback everywhere).
// ---------------------------------------------------------------------------

export interface SpeechTargets {
  texts: string[]
  elements: (HTMLElement | null)[]
}

/** Collect elements matching `selector` under `root`, in document order,
    skipping containers whose matched children carry the same text. */
export function collectSpeechTargets(root: HTMLElement | null, selector: string): SpeechTargets {
  const texts: string[] = []
  const elements: (HTMLElement | null)[] = []
  if (root) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      if (el.querySelector('p, li, h2, h3')) return
      const t = el.textContent?.replace(/\s+/g, ' ').trim()
      if (t) {
        texts.push(t)
        elements.push(el)
      }
    })
  }
  return { texts, elements }
}

const HIGHLIGHT_NAME = 'distill-tts'
const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS

function clearSentenceHighlight(): void {
  if (canHighlight) (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(HIGHLIGHT_NAME)
}

function setSentenceHighlight(range: Range): void {
  const HighlightCtor = (window as unknown as { Highlight?: new (r: Range) => unknown }).Highlight
  if (!canHighlight || !HighlightCtor) return
  ;(CSS as unknown as { highlights: Map<string, unknown> }).highlights.set(
    HIGHLIGHT_NAME,
    new HighlightCtor(range),
  )
}

/** Map a [start, end) range in the element's whitespace-normalized text
    (collapse runs to one space, trim leading) back to a DOM Range. */
function rangeForNormalizedOffsets(el: HTMLElement, start: number, end: number): Range | null {
  if (end <= start) return null
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let pos = 0
  let prevSpace = true
  let startSet = false
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = (node as Text).data
    for (let i = 0; i < text.length; i++) {
      const isSpace = /\s/.test(text[i])
      if (isSpace && prevSpace) continue
      if (!startSet && pos === start) {
        range.setStart(node, i)
        startSet = true
      }
      pos++
      prevSpace = isSpace
      if (pos === end) {
        if (!startSet) return null
        range.setEnd(node, i + 1)
        return range
      }
    }
  }
  return null
}

/** Keeps the spoken block visible and the spoken sentence highlighted.
    `elementsRef.current[block]` must be the element for spoken block index
    `block` (null entries — e.g. spoken-only intros — are simply skipped). */
export function useSpeechFollow(elementsRef: MutableRefObject<(HTMLElement | null)[]>): void {
  const tts = useTts()
  const lastEl = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (tts.status === 'idle') {
      lastEl.current?.classList.remove('tts-now')
      lastEl.current = null
      clearSentenceHighlight()
      return
    }
    const el = elementsRef.current[tts.block] ?? null
    if (el !== lastEl.current) {
      lastEl.current?.classList.remove('tts-now')
      if (el) {
        el.classList.add('tts-now')
        const r = el.getBoundingClientRect()
        if (r.top < window.innerHeight * 0.12 || r.bottom > window.innerHeight * 0.72) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      }
      lastEl.current = el
    }
    if (el) {
      const range = rangeForNormalizedOffsets(el, tts.charStart, tts.charEnd)
      if (range) setSentenceHighlight(range)
      else clearSentenceHighlight()
    } else {
      clearSentenceHighlight()
    }
  }, [tts.status, tts.block, tts.index, tts.charStart, tts.charEnd, elementsRef])

  useEffect(
    () => () => {
      lastEl.current?.classList.remove('tts-now')
      clearSentenceHighlight()
    },
    [],
  )
}
