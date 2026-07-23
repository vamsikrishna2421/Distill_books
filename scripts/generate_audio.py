#!/usr/bin/env python3
"""Batch-narrate the Distill library with Kokoro TTS.

For every book: chapters/NN.md -> audio-dist/<book>/ch-NN.m4a and the Stage-1
map -> audio-dist/<book>/map.m4a. Each audio file gets a manifest in
public/audio-manifests/<book>/ with per-block timestamps, whose block texts
mirror what the app renders so playback can highlight and auto-scroll.

Usage:
  generate_audio.py                 # everything (resumable; skips existing)
  generate_audio.py --book <id>     # one book
  generate_audio.py --item ch-01    # one item (with --book)
"""

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = ROOT / "src" / "content" / "books"
TOOLS = ROOT / ".tools"
AUDIO_OUT = ROOT / "audio-dist"
MANIFEST_OUT = ROOT / "public" / "audio-manifests"

GAP_SEC = 0.45
MAX_SYNTH_CHARS = 400
SAMPLE_RATE = 24000

# Single narrator across the whole library (user preference): Kokoro's
# top-rated voice, a warm female narrator. Per-book casting can return
# by adding entries here.
CASTING: dict[str, tuple[str, str]] = {}
DEFAULT_VOICE = ("af_heart", "The Guide")

# --- markdown -> spoken blocks ------------------------------------------------

INLINE = [
    (re.compile(r"\*\*(.+?)\*\*"), r"\1"),
    (re.compile(r"\*(.+?)\*"), r"\1"),
    (re.compile(r"__(.+?)__"), r"\1"),
    (re.compile(r"`(.+?)`"), r"\1"),
    (re.compile(r"\[(.+?)\]\([^)]*\)"), r"\1"),
]


def strip_inline(text: str) -> str:
    for pat, rep in INLINE:
        text = pat.sub(rep, text)
    return re.sub(r"\s+", " ", text).strip()


def md_blocks(md: str) -> list[str]:
    """Markdown body -> flat list of spoken blocks (headings, paragraphs,
    one block per list item, blockquotes), matching how the app renders."""
    blocks: list[str] = []
    para: list[str] = []

    def flush() -> None:
        if para:
            blocks.append(strip_inline(" ".join(para)))
            para.clear()

    for raw in md.split("\n"):
        line = raw.rstrip()
        s = line.strip()
        if not s:
            flush()
            continue
        if re.match(r"^!\[[^\]]*\]\([^)]*\)$", s):  # illustration — not spoken
            flush()
            continue
        if s.startswith("<"):  # raw HTML (figure cards etc.) — not spoken
            flush()
            continue
        m = re.match(r"^(#{2,4})\s+(.*)$", s)
        if m:
            flush()
            blocks.append(strip_inline(m.group(2)))
            continue
        m = re.match(r"^[-*]\s+(.*)$", s)
        if m:
            flush()
            blocks.append(strip_inline(m.group(1)))
            continue
        if s.startswith(">"):
            s = s.lstrip("> ").strip()
        para.append(s)
    flush()
    return [b for b in blocks if b]


def chapter_blocks(md: str, n: int) -> list[str]:
    title_m = re.search(r"^#\s+(.+)$", md, re.M)
    title = strip_inline(title_m.group(1)) if title_m else f"Chapter {n}"
    body = md[title_m.end():] if title_m else md

    key_ideas: list[str] = []
    in_practice: list[str] = []
    body_parts: list[str] = []

    for section in re.split(r"\n(?=##\s)", body):
        head_m = re.match(r"^##\s+(.+)$", section, re.M)
        heading = strip_inline(head_m.group(1)) if head_m else ""
        content = section[head_m.end():] if head_m else section
        low = heading.lower()
        if low.startswith("key ideas"):
            key_ideas = md_blocks(content)
        elif low.startswith("in practice"):
            in_practice = md_blocks(content)
        else:
            if heading:
                body_parts.append(heading)
            body_parts.extend(md_blocks(content))

    blocks = [f"Chapter {n}.", title]
    if key_ideas:
        # must match the headings the app renders for these sections
        blocks.append("The ideas in 30 seconds")
        blocks.extend(key_ideas)
    blocks.extend(body_parts)
    if in_practice:
        blocks.append("In practice")
        blocks.extend(in_practice)
    return blocks


GUESS_RE = re.compile(r"^:::\s*guess\s*\n(.*?)\n---\n(.*?)\n:::\s*$", re.S | re.M)


def story_blocks(md: str, n: int) -> list[str]:
    """stories/NN.md -> spoken blocks. Guess cards become the same
    'Pause and guess: ...' text the app renders, so manifests align."""
    title_m = re.search(r"^#\s+(.+)$", md, re.M)
    title = strip_inline(title_m.group(1)) if title_m else f"Chapter {n}"
    body = md[title_m.end():] if title_m else md

    blocks = [f"Chapter {n}.", title]
    cursor = 0
    for m in GUESS_RE.finditer(body):
        blocks.extend(md_blocks(body[cursor:m.start()]))
        blocks.append("Pause and guess: " + strip_inline(m.group(1)))
        blocks.append("[[pause:3]]")  # real thinking time before the reveal
        blocks.append("Ready? Here is what happened.")
        blocks.extend(md_blocks(m.group(2)))
        cursor = m.end()
    blocks.extend(md_blocks(body[cursor:]))
    return [b for b in blocks if b]


def map_blocks(book: dict) -> list[str]:
    blocks = [f"{book['title']}, by {book['author']}. The book map."]
    blocks.extend(md_blocks(book["map"]["intro"]))
    if book["map"].get("howToUse"):
        blocks.append("How to choose")
        blocks.extend(md_blocks(book["map"]["howToUse"]))
    for ch in book["map"]["chapters"]:
        blocks.append(strip_inline(ch["title"]))
        blocks.extend(md_blocks(ch["summary"]))
    blocks.append("End of the map. Pick the chapters that earn your time.")
    return [b for b in blocks if b]


# --- synthesis -----------------------------------------------------------------

SENT_RE = re.compile(r"[^.!?]+[.!?]+[\"')\]]*\s*|[^.!?]+$")


def synth_pieces(text: str) -> list[str]:
    """Split an over-long block at sentence boundaries for the engine."""
    if len(text) <= MAX_SYNTH_CHARS:
        return [text]
    pieces, cur = [], ""
    for s in SENT_RE.findall(text):
        if cur and len(cur) + len(s) > MAX_SYNTH_CHARS:
            pieces.append(cur.strip())
            cur = s
        else:
            cur += s
    if cur.strip():
        pieces.append(cur.strip())
    return pieces


def render(kokoro: Kokoro, blocks: list[str], voice: str, narrator: str,
           m4a_path: Path, manifest_path: Path, label: str) -> None:
    if m4a_path.exists() and manifest_path.exists():
        print(f"  skip {label} (exists)", flush=True)
        return
    t0 = time.time()
    gap = np.zeros(int(GAP_SEC * SAMPLE_RATE), dtype=np.float32)
    parts: list[np.ndarray] = []
    manifest_blocks = []
    cursor = 0.0
    for text in blocks:
        pause = re.fullmatch(r"\[\[pause:(\d+(?:\.\d+)?)\]\]", text)
        if pause:  # silence only — no manifest entry
            secs = float(pause.group(1))
            parts.append(np.zeros(int(secs * SAMPLE_RATE), dtype=np.float32))
            cursor += secs
            continue
        manifest_blocks.append({"t": round(cursor, 2), "text": text})
        for piece in synth_pieces(text):
            samples, sr = kokoro.create(piece, voice=voice, speed=1.0)
            if sr != SAMPLE_RATE:
                raise RuntimeError(f"unexpected sample rate {sr}")
            samples = samples.astype(np.float32)
            parts.append(samples)
            cursor += len(samples) / SAMPLE_RATE
        parts.append(gap)
        cursor += GAP_SEC
    audio = np.concatenate(parts)
    duration = len(audio) / SAMPLE_RATE

    m4a_path.parent.mkdir(parents=True, exist_ok=True)
    wav_path = m4a_path.with_suffix(".wav")
    sf.write(wav_path, audio, SAMPLE_RATE)
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac", "-b", "48000",
         str(wav_path), str(m4a_path)],
        check=True, capture_output=True,
    )
    wav_path.unlink()

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({
        "voice": voice,
        "narrator": narrator,
        "duration": round(duration, 2),
        "blocks": manifest_blocks,
    }, ensure_ascii=False))

    elapsed = time.time() - t0
    print(f"  done {label}: {duration/60:.1f} min audio in {elapsed/60:.1f} min "
          f"({duration/elapsed:.2f}x realtime)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book")
    ap.add_argument("--item", help="e.g. map or ch-01")
    args = ap.parse_args()

    kokoro = Kokoro(str(TOOLS / "kokoro-v1.0.onnx"), str(TOOLS / "voices-v1.0.bin"))

    book_dirs = sorted(d for d in BOOKS_DIR.iterdir() if (d / "book.json").exists())
    if args.book:
        book_dirs = [d for d in book_dirs if d.name == args.book]
        if not book_dirs:
            sys.exit(f"unknown book: {args.book}")

    for book_dir in book_dirs:
        book = json.loads((book_dir / "book.json").read_text())
        voice, narrator = CASTING.get(book_dir.name, DEFAULT_VOICE)
        print(f"{book_dir.name} — narrated by {narrator} ({voice})", flush=True)

        items: list[tuple[str, list[str]]] = []
        if not args.item or args.item == "map":
            items.append(("map", map_blocks(book)))
        for ch_file in sorted((book_dir / "chapters").glob("*.md")):
            n = int(ch_file.stem)
            name = f"ch-{ch_file.stem}"
            if args.item and args.item != name:
                continue
            items.append((name, chapter_blocks(ch_file.read_text(), n)))
        for st_file in sorted((book_dir / "stories").glob("*.md")) if (book_dir / "stories").is_dir() else []:
            n = int(st_file.stem)
            name = f"story-{st_file.stem}"
            if args.item and args.item != name:
                continue
            items.append((name, story_blocks(st_file.read_text(), n)))

        for name, blocks in items:
            render(
                kokoro, blocks, voice, narrator,
                AUDIO_OUT / book_dir.name / f"{name}.m4a",
                MANIFEST_OUT / book_dir.name / f"{name}.json",
                f"{book_dir.name}/{name}",
            )

    print("all done", flush=True)


if __name__ == "__main__":
    main()
