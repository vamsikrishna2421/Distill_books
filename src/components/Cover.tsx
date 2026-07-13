import type { CSSProperties } from 'react'
import type { Book } from '../types'

/**
 * Typographic book cover generated from the book's accent color.
 * Size is controlled by the parent via font-size (the cover scales in em).
 */
export function Cover({ book, className }: { book: Book; className?: string }) {
  return (
    <div
      className={className ? `cover ${className}` : 'cover'}
      style={{ '--accent': book.accent } as CSSProperties}
      aria-hidden="true"
    >
      <span className="cover-brand">DISTILL</span>
      <span className="cover-title">{book.title}</span>
      <span className="cover-author">{book.author}</span>
    </div>
  )
}
