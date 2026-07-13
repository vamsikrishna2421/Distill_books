import { marked } from 'marked'

marked.use({ gfm: true })

export function mdToHtml(src: string): string {
  return marked.parse(src, { async: false }) as string
}

export function mdInline(src: string): string {
  return marked.parseInline(src, { async: false }) as string
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={className ? `md ${className}` : 'md'}
      dangerouslySetInnerHTML={{ __html: mdToHtml(text) }}
    />
  )
}
