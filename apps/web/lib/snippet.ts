export interface Snippet {
  startMs: number;
  endMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  gainDb: number;
  normalize: boolean;
}

export const MIN_MS = 1000;
export const PRESETS_S = [5, 10, 15, 30] as const;

export const durationOf = (s: Snippet) => s.endMs - s.startMs;

/** Default: PRESET length from ~the start of the track body (or the whole track if shorter). */
export function defaultSnippet(trackMs: number, seconds = 15): Snippet {
  const len = Math.min(trackMs, seconds * 1000);
  const start = trackMs > len * 2 ? Math.round(trackMs * 0.3) : 0;
  return fit({ startMs: start, endMs: start + len, fadeInMs: 300, fadeOutMs: 600, gainDb: 0, normalize: false }, trackMs);
}

/** Clamp a snippet into [0, trackMs], enforce min length and fades <= length. */
export function fit(s: Snippet, trackMs: number): Snippet {
  const min = Math.min(MIN_MS, trackMs);
  let start = Math.max(0, Math.min(s.startMs, trackMs - min));
  const end = Math.min(trackMs, Math.max(s.endMs, start + min));
  if (end - start < min) start = end - min;
  const len = end - start;
  const fadeIn = Math.max(0, Math.min(s.fadeInMs, len));
  const fadeOut = Math.max(0, Math.min(s.fadeOutMs, len - fadeIn));
  return { ...s, startMs: Math.round(start), endMs: Math.round(end), fadeInMs: fadeIn, fadeOutMs: fadeOut };
}

/** Change length keeping the start (shifts left when it would run past the end). */
export function withDuration(s: Snippet, ms: number, trackMs: number): Snippet {
  const len = Math.min(trackMs, Math.max(Math.min(MIN_MS, trackMs), ms));
  const start = Math.min(s.startMs, trackMs - len);
  return fit({ ...s, startMs: start, endMs: start + len }, trackMs);
}

/** Linear gain (0..~4) at time t (ms, absolute) for live preview; mirrors the ffmpeg fades + gain. */
export function previewGain(s: Snippet, tMs: number): number {
  const rel = tMs - s.startMs;
  const len = durationOf(s);
  let g = 10 ** (s.gainDb / 20);
  if (s.fadeInMs > 0) g *= Math.min(1, Math.max(0, rel / s.fadeInMs));
  if (s.fadeOutMs > 0) g *= Math.min(1, Math.max(0, (len - rel) / s.fadeOutMs));
  return g;
}
