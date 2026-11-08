# Distill

A reading app for distilled non-fiction books. Each book has a one-page map (the big idea, how the chapters fit together, which to read first) and short distilled chapters, with optional narration that highlights and scrolls along as it plays.

The library ships with 17 books, including *Algorithms to Live By*, *Thinking, Fast and Slow*, *Superforecasting* and *Chanakya Neeti*.

## Stack

- React 18 + TypeScript, built with Vite
- React Router (`/` library, `/book/:bookId` map, `/book/:bookId/read/:num` reader)
- `marked` for chapter Markdown
- Progress and preferences stored in the browser (`localStorage`); no backend
- Deployed as a static site on Vercel (`vercel.json` rewrites all routes to `index.html`)

## Run it

```bash
npm ci
npm run dev        # local dev server
npm run build      # type-check + production build into dist/
npm test           # validate the content library (same as npm run validate)
```

## Content

```
src/content/categories.json
src/content/books/<book-id>/book.json      # metadata + the one-page map
src/content/books/<book-id>/chapters/NN.md # distilled chapters
src/content/books/<book-id>/stories/       # story items
```

`scripts/validate-content.mjs` checks the structure and flags short chapters. Run it after adding or editing a book.

## Narration

Pre-generated narration plays when it exists; otherwise the reader falls back to the browser's built-in speech (Web Speech API).

- `scripts/generate_audio.py` narrates books with Kokoro TTS (`kokoro_onnx`). It expects `.tools/kokoro-v1.0.onnx` and `.tools/voices-v1.0.bin`, writes audio to `audio-dist/`, and writes per-block timestamp manifests to `public/audio-manifests/`. Resumable; `--book <id>` and `--item ch-01` narrow it.
- `npm run audio:link` symlinks `audio-dist/` into `public/audio/` so the dev server can play it.
- `scripts/upload-audio.mjs` uploads the audio as assets on the `audio-v1` GitHub Release, which is where production builds load it from.
