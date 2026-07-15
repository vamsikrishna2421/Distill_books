import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { abJumpToBlock, useAudiobook } from './audiobook'
import type { ManifestBlock } from './audiobook'
import { ttsJumpToBlock, useTts } from './tts'

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

/** Align narration-manifest blocks to collected page elements by normalized
    text (sequential, small lookahead). Unmatched blocks map to null — spoken
    but not highlighted. */
export function alignManifestToElements(
  blocks: ManifestBlock[],
  targets: SpeechTargets,
): (HTMLElement | null)[] {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const targetNorm = targets.texts.map(norm)
  const out: (HTMLElement | null)[] = []
  let ptr = 0
  for (const b of blocks) {
    const nb = norm(b.text)
    let found = -1
    for (let j = ptr; j < targetNorm.length && j < ptr + 6; j++) {
      if (targetNorm[j] === nb) {
        found = j
        break
      }
    }
    if (found >= 0) {
      out.push(targets.elements[found])
      ptr = found + 1
    } else {
      out.push(null)
    }
  }
  return out
}

/** Click/tap-to-jump: route a click on (or inside) a spoken element to the
    active playback engine. No-op when nothing is playing or the click landed
    on a control. */
export function handleFollowJump(
  target: EventTarget | null,
  elements: (HTMLElement | null)[],
): void {
  const t = target instanceof HTMLElement ? target : null
  if (!t || t.closest('a, button, select, .audio-player')) return
  let idx = -1
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    if (el && (el === t || el.contains(t))) {
      idx = i
      break
    }
  }
  if (idx < 0) return
  if (!abJumpToBlock(idx)) ttsJumpToBlock(idx)
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
  const ab = useAudiobook()
  const lastEl = useRef<HTMLElement | null>(null)

  // file narration takes precedence; sentence ranges only exist for Web Speech
  const abActive = ab.status !== 'idle'
  const status = abActive ? ab.status : tts.status
  const block = abActive ? ab.block : tts.block
  const charStart = abActive ? -1 : tts.charStart
  const charEnd = abActive ? -1 : tts.charEnd

  useEffect(() => {
    if (status === 'idle') {
      lastEl.current?.classList.remove('tts-now')
      lastEl.current = null
      clearSentenceHighlight()
      return
    }
    const el = elementsRef.current[block] ?? null
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
    if (el && charStart >= 0) {
      const range = rangeForNormalizedOffsets(el, charStart, charEnd)
      if (range) setSentenceHighlight(range)
      else clearSentenceHighlight()
    } else {
      clearSentenceHighlight()
    }
  }, [status, block, tts.index, charStart, charEnd, elementsRef])

  useEffect(
    () => () => {
      lastEl.current?.classList.remove('tts-now')
      clearSentenceHighlight()
    },
    [],
  )
}
