#!/usr/bin/env node
// Upload generated narration (audio-dist/) as assets on the GitHub Release
// `audio-v1`, flat-named <book>--<item>.m4a. Uses the git credential already
// stored for github.com (read in-process, never printed). Resumable: existing
// assets are skipped.
//
//   node scripts/upload-audio.mjs [--check]   # --check: auth test only

import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OWNER = 'vamsikrishna2421'
const REPO = 'Distill_books'
const TAG = 'audio-v1'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIO = join(root, 'audio-dist')
const checkOnly = process.argv.includes('--check')

function getToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  const m = out.match(/^password=(.+)$/m)
  if (!m) throw new Error('no stored github.com credential found')
  return m[1]
}

const token = getToken()
const api = 'https://api.github.com'
const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'distill-audio-upload',
}

async function gh(path, init = {}) {
  const res = await fetch(path.startsWith('http') ? path : api + path, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
  return res
}

// --- auth / scope check -------------------------------------------------------
const repoRes = await gh(`/repos/${OWNER}/${REPO}`)
if (!repoRes.ok) {
  console.error(`auth check FAILED: ${repoRes.status} ${repoRes.statusText}`)
  console.error('the stored git credential cannot use the GitHub API — run: gh auth login')
  process.exit(1)
}
const scopes = repoRes.headers.get('x-oauth-scopes') ?? '(fine-grained or app token)'
console.log(`auth OK — token scopes: ${scopes}`)
if (checkOnly) process.exit(0)

// --- find or create the release ------------------------------------------------
let release
{
  const res = await gh(`/repos/${OWNER}/${REPO}/releases/tags/${TAG}`)
  if (res.ok) {
    release = await res.json()
    console.log(`release ${TAG} exists (id ${release.id})`)
  } else {
    const create = await gh(`/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: TAG,
        name: 'Distill narration v1',
        body: 'Pre-generated Kokoro narration for all books (m4a, 48kbps AAC). Served by the app at distill-books.vercel.app.',
        draft: false,
        prerelease: false,
      }),
    })
    if (!create.ok) {
      console.error(`failed to create release: ${create.status} ${await create.text()}`)
      process.exit(1)
    }
    release = await create.json()
    console.log(`created release ${TAG} (id ${release.id})`)
  }
}

const existing = new Set()
{
  let page = 1
  for (;;) {
    const res = await gh(`/repos/${OWNER}/${REPO}/releases/${release.id}/assets?per_page=100&page=${page}`)
    const assets = await res.json()
    if (!Array.isArray(assets) || assets.length === 0) break
    assets.forEach((a) => existing.add(a.name))
    page++
  }
}
console.log(`${existing.size} assets already uploaded`)

// --- upload ---------------------------------------------------------------------
if (!existsSync(AUDIO)) {
  console.log('no audio-dist directory — nothing to upload')
  process.exit(0)
}

let uploaded = 0
let skipped = 0
for (const book of readdirSync(AUDIO, { withFileTypes: true })) {
  if (!book.isDirectory()) continue
  for (const file of readdirSync(join(AUDIO, book.name)).sort()) {
    if (!file.endsWith('.m4a')) continue
    const asset = `${book.name}--${file}`
    if (existing.has(asset)) {
      skipped++
      continue
    }
    const path = join(AUDIO, book.name, file)
    const size = statSync(path).size
    const res = await fetch(
      `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(asset)}`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'audio/mp4', 'Content-Length': String(size) },
        body: createReadStream(path),
        duplex: 'half',
      },
    )
    if (!res.ok) {
      console.error(`  FAILED ${asset}: ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    uploaded++
    console.log(`  uploaded ${asset} (${(size / 1e6).toFixed(1)} MB)`)
  }
}
console.log(`done: ${uploaded} uploaded, ${skipped} already present`)
