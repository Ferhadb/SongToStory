import { lineCount, type TextOpts } from "./measure";

export interface LyricLine { startMs: number; endMs: number; text: string }

export const SWITCH_MS = 450;

/** Line shown as active at `ms` (the last one started, none before the first), and eased 0..1 progress of the switch into it. */
export function activeAt(lines: readonly LyricLine[], ms: number): { idx: number; t: number } {
  let idx = -1;
  for (let i = 0; i < lines.length && lines[i].startMs <= ms; i++) idx = i;
  return { idx, t: idx < 0 ? 1 : Math.min(1, (ms - lines[idx].startMs) / SWITCH_MS) };
}

/** Visual slot of line `i` (0 = active position, -1 = previous, 1 = next). Slides up by one while `t` runs 0 -> 1. */
export const slotOf = (i: number, idx: number, eased: number) => i - idx + (1 - eased);

/** Opacity by distance from the active slot: full at 0, dim at ±1, gone by ±2. */
export const slotOpacity = (slot: number) => Math.max(0, 1 - Math.abs(slot) * 0.65) * Math.min(1, Math.max(0, 2 - Math.abs(slot)));

export const LINE_HEIGHT = 1.15;
const GAP = 0.5; // between lines, in font sizes

export interface LyricsFit { size: number; heights: number[]; gap: number }

/** Largest font size (<= maxSize) at which every three consecutive lines, wrapped to width `w`, fit in height `h`. */
export function fitLyrics(texts: readonly string[], font: string, o: TextOpts, w: number, h: number, maxSize: number): LyricsFit {
  const minSize = Math.max(12, maxSize * 0.4);
  for (let size = Math.round(maxSize); ; size = Math.floor(size * 0.94)) {
    const heights = texts.map((t) => lineCount(t, font, size, w, o) * size * LINE_HEIGHT);
    const worst = Math.max(0, ...heights.map((hh, i) => (heights[i - 1] ?? 0) + hh + (heights[i + 1] ?? 0)));
    const gap = size * GAP;
    if (worst + 2 * gap <= h || size <= minSize) return { size, heights, gap };
  }
}

/** Top of line `i` when line `a` is the active one, centred on `cy`. */
export function lineTop(i: number, a: number, cy: number, f: LyricsFit): number {
  let off = 0;
  for (let j = a; j < i; j++) off += f.heights[j] + f.gap;
  for (let j = i; j < a; j++) off -= f.heights[j] + f.gap;
  return cy - (f.heights[a] ?? 0) / 2 + off;
}

/** Stand-in lines for template thumbnails (never part of a saved project). Only the first is "active" in a short clip. */
export const SAMPLE_LYRICS: LyricLine[] = [
  { startMs: 0, endMs: 1e9, text: "Your lyrics show up here" },
  { startMs: 1e9, endMs: 2e9, text: "one line at a time," },
  { startMs: 2e9, endMs: 3e9, text: "synced to the song" },
];
