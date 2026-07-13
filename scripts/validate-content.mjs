#!/usr/bin/env node
// Validates the Distill content library:
//   src/content/books/<id>/book.json  — metadata + Stage-1 map
//   src/content/books/<id>/chapters/NN.md — Stage-2 distilled chapters
// Exits 1 on structural errors; prints a per-book summary.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BOOKS_DIR = join(here, '..', 'src', 'content', 'books')
const CATEGORIES = join(here, '..', 'src', 'content', 'categories.json')

const errors = []
const warnings = []

function countWords(s) {
  const t = String(s ?? '').trim()
  return t ? t.split(/\s+/).length : 0
}

if (!existsSync(BOOKS_DIR)) {
  console.log('No books directory yet — nothing to validate.')
  process.exit(0)
}

let categoryIds = new Set()
try {
  categoryIds = new Set(JSON.parse(readFileSync(CATEGORIES, 'utf8')).map((c) => c.id))
} catch (e) {
  errors.push(`categories.json unreadable: ${e.message}`)
}

const bookDirs = readdirSync(BOOKS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

const REQUIRED = [
  'id', 'title', 'author', 'year', 'originalPages', 'categoryId',
  'difficulty', 'syllabusOrder', 'accent', 'tagline', 'whyRead', 'map',
]

const rows = []

for (const dir of bookDirs) {
  const bookPath = join(BOOKS_DIR, dir, 'book.json')
  const prefix = `${dir}:`

  if (!existsSync(bookPath)) {
    errors.push(`${prefix} missing book.json`)
    continue
  }

  let book
  try {
    book = JSON.parse(readFileSync(bookPath, 'utf8'))
  } catch (e) {
    errors.push(`${prefix} book.json is not valid JSON — ${e.message}`)
    continue
  }

  for (const f of REQUIRED) {
    if (book[f] === undefined || book[f] === null || book[f] === '') {
      if (f === 'subtitle') continue
      errors.push(`${prefix} book.json missing field "${f}"`)
    }
  }

  if (book.id && book.id !== dir) errors.push(`${prefix} id "${book.id}" ≠ directory name`)
  if (book.categoryId && !categoryIds.has(book.categoryId)) {
    errors.push(`${prefix} unknown categoryId "${book.categoryId}"`)
  }

  const mapChapters = book.map?.chapters
  if (!Array.isArray(mapChapters) || mapChapters.length === 0) {
    errors.push(`${prefix} map.chapters missing or empty`)
    continue
  }

  const numbers = mapChapters.map((c) => c.number).sort((a, b) => a - b)
  const expected = Array.from({ length: mapChapters.length }, (_, i) => i + 1)
  if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
    errors.push(`${prefix} map chapter numbers not contiguous 1..${mapChapters.length}: ${numbers}`)
  }

  for (const c of mapChapters) {
    if (!c.title) errors.push(`${prefix} map chapter ${c.number} missing title`)
    if (!c.summary) errors.push(`${prefix} map chapter ${c.number} missing summary`)
    else {
      const w = countWords(c.summary)
      if (w < 90) warnings.push(`${prefix} map chapter ${c.number} summary short (${w} words)`)
    }
    if (!Array.isArray(c.readIf) || c.readIf.length === 0) {
      warnings.push(`${prefix} map chapter ${c.number} has no readIf hooks`)
    }
  }

  // chapter files
  const chDir = join(BOOKS_DIR, dir, 'chapters')
  const files = existsSync(chDir) ? readdirSync(chDir).filter((f) => /^\d+\.md$/.test(f)) : []
  const fileNums = new Set(files.map((f) => parseInt(f, 10)))
  let totalWords = 0

  for (const c of mapChapters) {
    if (!fileNums.has(c.number)) {
      errors.push(`${prefix} missing chapter file for map chapter ${c.number} ("${c.title}")`)
    }
  }
  for (const num of fileNums) {
    if (!mapChapters.some((c) => c.number === num)) {
      warnings.push(`${prefix} chapter file ${num} has no map entry`)
    }
  }

  for (const f of files.sort()) {
    const raw = readFileSync(join(chDir, f), 'utf8')
    const p = `${prefix} chapters/${f}`
    if (!/^#\s+.+/m.test(raw)) errors.push(`${p} missing "# Title" heading`)
    if (!/^##\s+Key Ideas/mi.test(raw)) errors.push(`${p} missing "## Key Ideas" section`)
    if (!/^##\s+In Practice/mi.test(raw)) errors.push(`${p} missing "## In Practice" section`)
    const w = countWords(raw)
    totalWords += w
    if (w < 800) warnings.push(`${p} short (${w} words)`)
    if (w > 3200) warnings.push(`${p} long (${w} words)`)
  }

  rows.push({
    id: dir,
    chapters: `${files.length}/${mapChapters.length}`,
    words: totalWords,
  })
}

console.log('\nDistill content check')
console.log('─'.repeat(56))
for (const r of rows) {
  console.log(
    `  ${r.id.padEnd(28)} ${String(r.chapters).padStart(5)} chapters  ${(r.words / 1000).toFixed(1).padStart(6)}k words`,
  )
}
console.log('─'.repeat(56))
console.log(`${rows.length} books · ${warnings.length} warnings · ${errors.length} errors`)

if (warnings.length) {
  console.log('\nWarnings:')
  for (const w of warnings) console.log(`  ⚠ ${w}`)
}
if (errors.length) {
  console.log('\nErrors:')
  for (const e of errors) console.log(`  ✗ ${e}`)
  process.exit(1)
}
console.log('\nAll good ✓')
