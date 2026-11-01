/** Per-frame audio analysis as produced by the backend: frames × (bands + 1) uint8, last column = RMS. */
export interface AnalysisPayload { fps: number; bands: number; frames: number; data: string }
export interface Analysis { fps: number; bands: number; frames: number; data: Uint8Array }

export function decodeAnalysis(p: AnalysisPayload): Analysis {
  const bin = atob(p.data);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { fps: p.fps, bands: p.bands, frames: p.frames, data };
}

const stride = (a: Analysis) => a.bands + 1;
const clampFrame = (a: Analysis, f: number) => Math.min(a.frames - 1, Math.max(0, Math.round(f)));

/** Raw 0..1 value for a band at a frame. */
function raw(a: Analysis, frame: number, band: number): number {
  return a.data[clampFrame(a, frame) * stride(a) + band] / 255;
}

/**
 * Smoothed levels resampled to `n` bars. Smoothing is a decaying max over the previous frames, so it is a
 * pure function of `frame` (no state) and preview and export agree. `smoothing` 0 = raw, 1 = long tails.
 */
export function levelsAt(a: Analysis | null, frame: number, n: number, smoothing = 0.5): number[] {
  const out = new Array<number>(n).fill(0);
  if (!a || a.frames === 0) return out;
  const decay = 0.55 + smoothing * 0.38; // per-frame multiplier of the trailing peak
  const taps = smoothing <= 0 ? 1 : 8;
  for (let i = 0; i < n; i++) {
    const lo = (i / n) * a.bands, hi = Math.max(lo + 1, ((i + 1) / n) * a.bands);
    const b0 = Math.floor(lo), b1 = Math.min(a.bands, Math.ceil(hi));
    let v = 0;
    for (let k = 0; k < taps; k++) {
      let m = 0;
      for (let b = b0; b < b1; b++) m = Math.max(m, raw(a, frame - k, b));
      v = Math.max(v, m * decay ** k);
    }
    out[i] = v;
  }
  return out;
}

export function rmsAt(a: Analysis | null, frame: number): number {
  return a && a.frames ? raw(a, frame, a.bands) : 0;
}

/** Low-end energy (bottom ~6 of 64 bands, ≈ below 120 Hz), smoothed — drives the cover pulse. */
export function bassAt(a: Analysis | null, frame: number, smoothing = 0.5): number {
  if (!a || !a.frames) return 0;
  const n = Math.max(1, Math.round(a.bands * 0.1));
  let v = 0;
  const decay = 0.55 + smoothing * 0.38;
  for (let k = 0; k < 6; k++) {
    let m = 0;
    for (let b = 0; b < n; b++) m += raw(a, frame - k, b);
    v = Math.max(v, (m / n) * decay ** k);
  }
  return v;
}
