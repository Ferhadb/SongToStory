/**
 * Deterministic text-width estimates, so layouts can be sized from the actual song title without a DOM (templates are built
 * in the store, in tests and in the renderer alike). Widths are average advance per character class, in em, per font.
 */
export interface FontMetrics {
  lower: number; upper: number; digit: number; space: number; punct: number;
  /** Cyrillic glyphs relative to the Latin ones of the same case. */
  cyr: number;
}

const METRICS: Record<string, FontMetrics> = {
  Inter: { lower: 0.545, upper: 0.68, digit: 0.62, space: 0.28, punct: 0.3, cyr: 1.04 },
  Manrope: { lower: 0.57, upper: 0.7, digit: 0.64, space: 0.26, punct: 0.3, cyr: 1.05 },
  "Playfair Display": { lower: 0.5, upper: 0.7, digit: 0.56, space: 0.25, punct: 0.28, cyr: 1.06 },
  Unbounded: { lower: 0.74, upper: 0.88, digit: 0.8, space: 0.3, punct: 0.4, cyr: 1.03 },
  Oswald: { lower: 0.42, upper: 0.5, digit: 0.5, space: 0.2, punct: 0.24, cyr: 1.04 },
  "JetBrains Mono": { lower: 0.6, upper: 0.6, digit: 0.6, space: 0.6, punct: 0.6, cyr: 1 },
  Fraunces: { lower: 0.53, upper: 0.7, digit: 0.58, space: 0.25, punct: 0.28, cyr: 1.05 },
};
const FALLBACK = METRICS.Inter;

const CYR_UPPER = /[А-ЯЁЀ-Џ]/;
const CYR_LOWER = /[а-яёѐ-џ]/;
const WIDE = /[　-鿿＀-￯가-힯]/; // CJK, fullwidth, Hangul

/** `letterSpacing` is px per character; `tracking` is the same in em (scales with the size being tried). */
export interface TextOpts { weight?: number; letterSpacing?: number; tracking?: number; upper?: boolean }

/** Heavier weights are wider; ~+4% per 100 above 500 is close for the variable fonts used here. */
const weightFactor = (w = 500) => 1 + (w - 500) * 0.0004;

export function textWidth(s: string, font: string, size: number, o: TextOpts = {}): number {
  const m = METRICS[font] ?? FALLBACK;
  let em = 0;
  for (const ch of s) {
    const up = o.upper ? ch.toUpperCase() : ch;
    if (WIDE.test(ch)) em += 1;
    else if (CYR_UPPER.test(up)) em += m.upper * m.cyr;
    else if (CYR_LOWER.test(up)) em += m.lower * m.cyr;
    else if (/[A-Z]/.test(up)) em += m.upper;
    else if (/[a-z]/.test(up)) em += m.lower;
    else if (/\d/.test(up)) em += m.digit;
    else if (/\s/.test(up)) em += m.space;
    else if (/[\p{L}]/u.test(up)) em += m.lower * 1.02;
    else if (/\p{Extended_Pictographic}/u.test(ch)) em += 1.15;
    else em += m.punct;
  }
  const n = [...s].length;
  return em * size * weightFactor(o.weight) + n * ((o.letterSpacing ?? 0) + (o.tracking ?? 0) * size);
}

/** Estimates are widened by this much before deciding that something fits, so a miss errs towards a smaller title. */
export const FIT_SAFETY = 1.06;

/** Number of lines `s` takes in a box `maxW` wide (greedy word wrap; over-long words break anywhere, like overflow-wrap). */
export function lineCount(s: string, font: string, size: number, maxW: number, o: TextOpts = {}): number {
  const limit = maxW / FIT_SAFETY;
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const space = textWidth(" ", font, size, o);
  let lines = 1, cur = 0;
  for (const word of words) {
    const w = textWidth(word, font, size, o);
    if (w > limit) { // break the word itself
      if (cur > 0) { lines++; cur = 0; }
      const full = Math.floor(w / limit);
      lines += full;
      cur = w - full * limit;
      if (cur === 0 && full > 0) { lines--; cur = limit; }
    } else if (cur === 0) cur = w;
    else if (cur + space + w <= limit) cur += space + w;
    else { lines++; cur = w; }
  }
  return lines;
}

export interface FitRequest extends TextOpts {
  font: string; maxW: number; maxLines: number; maxSize: number; minSize: number;
  /** When set, also require lines * size * lineHeight <= maxH. */
  maxH?: number; lineHeight?: number;
}
export interface Fit { size: number; lines: number; fits: boolean }

/** Largest font size in [minSize, maxSize] at which `s` fits in maxLines (and maxH). `fits` is false if even minSize overflows. */
export function fitText(s: string, r: FitRequest): Fit {
  const step = Math.max(1, Math.round(r.maxSize * 0.015));
  for (let size = Math.round(r.maxSize); size >= r.minSize; size -= step) {
    const lines = lineCount(s, r.font, size, r.maxW, r);
    if (lines <= r.maxLines && (r.maxH === undefined || lines * size * (r.lineHeight ?? 1.1) <= r.maxH)) return { size, lines, fits: true };
  }
  const size = Math.round(r.minSize);
  return { size, lines: Math.min(r.maxLines, lineCount(s, r.font, size, r.maxW, r)), fits: false };
}

export const hasCyrillic = (s: string) => /[Ѐ-ӿ]/.test(s);
