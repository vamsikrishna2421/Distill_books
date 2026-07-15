#!/usr/bin/env node
// Expose generated narration to the dev server: symlink audio-dist/<book>/<item>.m4a
// as public/audio/<book>--<item>.m4a (flat, mirroring the GitHub Release asset names).

import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'audio-dist')
const dest = join(root, 'public', 'audio')

if (!existsSync(src)) {
  console.log('no audio-dist yet — run scripts/generate_audio.py first')
  process.exit(0)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

let count = 0
for (const book of readdirSync(src, { withFileTypes: true })) {
  if (!book.isDirectory()) continue
  for (const file of readdirSync(join(src, book.name))) {
    if (!file.endsWith('.m4a')) continue
    symlinkSync(join(src, book.name, file), join(dest, `${book.name}--${file}`))
    count++
  }
}
console.log(`linked ${count} audio files into public/audio`)
