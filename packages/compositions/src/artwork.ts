/** Cover artwork: palette, theme, crop/adjust rendering, generated covers. Framework-free so the
 *  same functions can run in the editor preview and, later, inside the render composition. */

export type RGB = [number, number, number];

// ---------- color ----------
export const toHex = ([r, g, b]: RGB) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function saturation([r, g, b]: RGB): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

/** Dominant colors from RGBA pixels via 4-bit/channel bucketing; near-duplicates are merged. */
export function extractPalette(rgba: Uint8ClampedArray | Uint8Array, count = 5): RGB[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
    else buckets.set(key, { n: 1, r, g, b });
  }
  const all = [...buckets.values()]
    .map((e) => ({ n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n] as RGB }))
    .sort((a, b) => b.n - a.n);
  const out: RGB[] = [];
  for (const { c } of all) {
    if (out.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 48)) out.push(c);
    if (out.length === count) break;
  }
  return out;
}

export interface Theme { background: RGB; text: RGB; accent: RGB; }

/** Suggest a readable theme: darkened dominant as background, best-contrast text, vivid accent. */
export function themeFromPalette(palette: RGB[]): Theme {
  const base: RGB = palette[0] ?? [24, 24, 24];
  const background = base.map((v) => v * 0.35) as RGB;
  const white: RGB = [255, 255, 255], black: RGB = [12, 12, 12];
  const text = contrast(background, white) >= contrast(background, black) ? white : black;
  const candidates = palette.filter((c) => contrast(background, c) >= 3);
  const accent = (candidates.length ? candidates : [text]).reduce((best, c) => (saturation(c) > saturation(best) ? c : best));
  return { background, text, accent };
}

// ---------- crop / adjust ----------
export interface CoverParams {
  zoom: number; // 1..4
  offsetX: number; // -1..1 of the overflow
  offsetY: number;
  rotation: number; // degrees
  radius: number; // 0..50 (% of size)
  brightness: number; // 0..200 (%)
  contrast: number;
  saturation: number;
  blur: number; // px at 1080 reference
  grain: number; // 0..100
}

export const DEFAULT_COVER: CoverParams = {
  zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, radius: 0,
  brightness: 100, contrast: 100, saturation: 100, blur: 0, grain: 0,
};

export function coverFilter(p: CoverParams, size: number): string {
  const parts = [`brightness(${p.brightness}%)`, `contrast(${p.contrast}%)`, `saturate(${p.saturation}%)`];
  if (p.blur > 0) parts.push(`blur(${((p.blur * size) / 1080).toFixed(2)}px)`);
  return parts.join(" ");
}

export const isDefault = (p: CoverParams) => JSON.stringify(p) === JSON.stringify(DEFAULT_COVER);

/** Deterministic PRNG so grain is identical frame-to-frame and preview-to-export. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Square cover-fit with zoom/pan/rotation, CSS-style filters, rounded corners and grain. */
export function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, p: CoverParams, size: number) {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  const r = (p.radius / 100) * size;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  ctx.clip();
  ctx.filter = coverFilter(p, size);
  const base = Math.max(size / img.width, size / img.height) * p.zoom;
  const w = img.width * base, h = img.height * base;
  const maxX = Math.max(0, (w - size) / 2), maxY = Math.max(0, (h - size) / 2);
  ctx.translate(size / 2 + p.offsetX * maxX, size / 2 + p.offsetY * maxY);
  ctx.rotate((p.rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (p.grain > 0) drawGrain(ctx, size, p.grain, r);
}

function drawGrain(ctx: CanvasRenderingContext2D, size: number, amount: number, radius: number) {
  const n = 128;
  const tile = new ImageData(n, n);
  const rnd = mulberry32(1234);
  for (let i = 0; i < tile.data.length; i += 4) {
    const v = rnd() * 255;
    tile.data[i] = tile.data[i + 1] = tile.data[i + 2] = v;
    tile.data[i + 3] = (amount / 100) * 70;
  }
  const c = document.createElement("canvas");
  c.width = c.height = n;
  c.getContext("2d")!.putImageData(tile, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, radius);
  ctx.clip();
  ctx.fillStyle = ctx.createPattern(c, "repeat")!;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

// ---------- generated covers ----------
export type GeneratedStyle = "typographic" | "gradient" | "blurred" | "geometric";
export const GENERATED_STYLES: { id: GeneratedStyle; label: string }[] = [
  { id: "typographic", label: "Typographic" },
  { id: "gradient", label: "Gradient" },
  { id: "blurred", label: "Blurred color" },
  { id: "geometric", label: "Geometric" },
];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function seedColors(seed: string): [string, string, string] {
  const h = hashString(seed) % 360;
  return [`hsl(${h} 55% 38%)`, `hsl(${(h + 40) % 360} 60% 52%)`, `hsl(${(h + 200) % 360} 45% 18%)`];
}

export function wrapLines(measure: (s: string) => number, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

export function drawGenerated(
  ctx: CanvasRenderingContext2D, style: GeneratedStyle, title: string, artist: string,
  seed: string, fontFamily: string, size = 1200,
) {
  const [c1, c2, c3] = seedColors(seed);
  const rnd = mulberry32(hashString(seed));
  ctx.clearRect(0, 0, size, size);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  if (style === "gradient" || style === "blurred") { bg.addColorStop(0, c1); bg.addColorStop(1, c3); }
  else { bg.addColorStop(0, c3); bg.addColorStop(1, c3); }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  if (style === "blurred") {
    ctx.filter = `blur(${size * 0.09}px)`;
    for (const col of [c2, c1, c2]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, size * (0.18 + rnd() * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = "none";
  }
  if (style === "geometric") {
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? c1 : c2;
      ctx.globalAlpha = 0.85;
      const s = size * (0.25 + rnd() * 0.4);
      ctx.beginPath();
      if (i % 2) ctx.arc(rnd() * size, rnd() * size, s / 2, 0, Math.PI * 2);
      else ctx.rect(rnd() * (size - s), rnd() * (size - s), s, s);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Text: typographic style is type-led; others keep it small at the bottom.
  const pad = size * 0.08;
  const big = style === "typographic";
  const tSize = big ? size * 0.14 : size * 0.075;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${tSize}px ${fontFamily}`;
  const lines = wrapLines((s) => ctx.measureText(s).width, title, size - pad * 2, big ? 4 : 2);
  const lh = tSize * 1.08;
  const aSize = tSize * 0.42;
  const blockH = lines.length * lh + aSize * 1.6;
  let y = big ? pad + tSize : size - pad - blockH + tSize;
  for (const l of lines) { ctx.fillText(l, pad, y); y += lh; }
  ctx.globalAlpha = 0.8;
  ctx.font = `500 ${aSize}px ${fontFamily}`;
  ctx.fillText(artist, pad, y + aSize * 0.4);
  ctx.globalAlpha = 1;
}

// ---------- shared transform math (DOM + canvas use the same numbers) ----------
/** Where the image sits inside a square cover box of `size` px. Mirrors drawCover exactly. */
export function coverTransform(p: CoverParams, imgW: number, imgH: number, size: number) {
  const base = Math.max(size / imgW, size / imgH) * p.zoom;
  const w = imgW * base, h = imgH * base;
  const maxX = Math.max(0, (w - size) / 2), maxY = Math.max(0, (h - size) / 2);
  return { width: w, height: h, left: size / 2 - w / 2 + p.offsetX * maxX, top: size / 2 - h / 2 + p.offsetY * maxY, rotation: p.rotation };
}

let grainCache: string | null = null;
/** Deterministic grain tile as a data URL (empty string when no DOM, e.g. SSR). */
export function grainTile(): string {
  if (grainCache) return grainCache;
  if (typeof document === "undefined") return "";
  const n = 128;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d")!;
  const d = ctx.createImageData(n, n);
  const rnd = mulberry32(1234);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = rnd() * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return (grainCache = c.toDataURL("image/png"));
}
