/**
 * FROZEN: the original ("v1") template layouts. Projects saved before template versioning keep rendering and
 * re-laying out through this code, so do not change its output; refreshed designs live in templates.ts.
 * legacy-layouts.test.ts compares it against a snapshot of the original output.
 */
import { NO_ANIM } from "./animations";
import { hueShift, mix, luma, shade, safeArea, type Safe } from "./kit";
import { DEFAULT_VIS } from "./Visualizer";
import { ASPECTS, type AspectId, type Background, type Project, type StoryElement, type TextStyle } from "./schema";

const anim = (type: StoryElement["in"]["type"], startMs: number, durationMs = 700) => ({ ...NO_ANIM, type, startMs, durationMs });

function text(over: Partial<TextStyle>): TextStyle {
  return {
    fontFamily: "Inter", fontSize: 48, fontWeight: 600, letterSpacing: 0, lineHeight: 1.15, color: "#ffffff",
    align: "left", maxLines: 2, shadow: false, uppercase: false, ...over,
  };
}

let uid = 0;
const mk = (type: StoryElement["type"], name: string, r: [number, number, number, number], over: Partial<StoryElement> = {}): StoryElement => ({
  id: `${type}-${++uid}`, type, name, visible: true, x: Math.round(r[0]), y: Math.round(r[1]), w: Math.round(r[2]), h: Math.round(r[3]), rotation: 0, opacity: 1,
  in: anim("none", 0), out: NO_ANIM, ...over,
});

export type Preset = "classic" | "glass" | "cover-first" | "minimal" | "visualizer" | "polaroid";
export interface Colors { text: string; accent: string; bg: string }

// ---------- layout ----------

interface Ctx { title: string; W: number; H: number; land: boolean; tall: boolean; s: Safe; innerW: number; fs: (n: number) => number; c: Colors }
function ctxOf(aspect: AspectId, c: Colors, title: string): Ctx {
  const { w: W, h: H } = ASPECTS[aspect];
  const s = safeArea(aspect);
  const land = W > H;
  const scale = land ? H / 1080 : W / 1080; // type scale relative to a 1080-short-edge canvas
  return { title, W, H, land, tall: aspect === "9:16", s, innerW: W - s.side * 2, fs: (n) => Math.round(n * scale), c };
}

interface InfoOpts {
  align: TextStyle["align"];
  kicker?: string; kickerColor?: string;
  titleFs: number; titleFont: string; titleWeight: number; titleLines: number; titleUpper?: boolean; titleLS?: number; titleLH?: number;
  artistFs: number; artistFont: string; artistWeight: number; artistUpper?: boolean; artistLS?: number;
  barColor?: string; barH?: number; trackOpacity?: number;
  timeFont?: string; timeFs?: number; ctl?: boolean; color?: string;
}

function infoHeight(x: Ctx, o: InfoOpts): number {
  const { fs } = x;
  return (o.kicker ? fs(30) + fs(22) : 0) + o.titleFs * (o.titleLH ?? 1.12) * o.titleLines + o.artistFs * 1.4 + fs(6) + fs(34) + (o.barH ?? 10) + fs(14) + fs(o.timeFs ?? 30) * 1.3 + (o.ctl ? fs(34) + fs(96) : 0);
}

/** kicker / title / artist / progress / times / controls, stacked from (px, y) across width w. */
function infoBlock(x: Ctx, o: InfoOpts, px: number, y: number, w: number, t0 = 150): StoryElement[] {
  const { fs, c } = x;
  const col = o.color ?? c.text;
  const out: StoryElement[] = [];
  const barH = o.barH ?? 10, tfs = fs(o.timeFs ?? 30);
  if (o.kicker) {
    out.push(mk("text", "Kicker", [px, y, w, fs(30)], { content: o.kicker, text: text({ fontFamily: "Inter", fontSize: fs(24), fontWeight: 700, letterSpacing: 6, uppercase: true, color: o.kickerColor ?? c.accent, align: o.align, maxLines: 1 }), in: anim("fade", t0 - 100) }));
    y += fs(30) + fs(22);
  }
  const titleH = o.titleFs * (o.titleLH ?? 1.12) * o.titleLines;
  out.push(mk("title", "Title", [px, y, w, titleH], { text: text({ fontFamily: o.titleFont, fontSize: o.titleFs, fontWeight: o.titleWeight, color: col, align: o.align, maxLines: o.titleLines + 1, uppercase: !!o.titleUpper, letterSpacing: o.titleLS ?? 0, lineHeight: o.titleLH ?? 1.12, valign: "bottom" }), in: anim("slide-up", t0) }));
  y += titleH + fs(6);
  const artistH = o.artistFs * 1.4;
  out.push(mk("artist", "Artist", [px, y, w, artistH], { text: text({ fontFamily: o.artistFont, fontSize: o.artistFs, fontWeight: o.artistWeight, color: col, align: o.align, maxLines: 1, uppercase: !!o.artistUpper, letterSpacing: o.artistLS ?? 0 }), opacity: 0.72, in: anim("slide-up", t0 + 100) }));
  y += artistH + fs(34);
  out.push(mk("progress", "Progress", [px, y, w, barH], { bar: { color: o.barColor ?? col, trackColor: col, trackOpacity: o.trackOpacity ?? 0.26, rounded: true }, in: anim("fade", t0 + 250) }));
  y += barH + fs(14);
  const tf = o.timeFont ?? "Inter";
  const ts = (align: "left" | "right") => text({ fontFamily: tf, fontSize: tfs, color: col, fontWeight: 500, align, maxLines: 1 });
  out.push(mk("time", "Elapsed", [px, y, w / 2, tfs * 1.3], { timeKind: "elapsed", text: ts("left"), opacity: 0.7, in: anim("fade", t0 + 300) }));
  out.push(mk("time", "Total", [px + w / 2, y, w / 2, tfs * 1.3], { timeKind: "total", text: ts("right"), opacity: 0.7, in: anim("fade", t0 + 300) }));
  if (o.ctl) {
    y += tfs * 1.3 + fs(34);
    out.push(mk("controls", "Controls", [px + w / 2 - fs(190), y, fs(380), fs(96)], { ctl: { color: col }, in: anim("fade", t0 + 450) }));
  }
  return out;
}

/**
 * Rough title metrics from its length (cw = average glyph width as a fraction of the font size), so the info block hugs the
 * text instead of reserving lines it won't use. `grow`: a title that fits one line at a larger size is scaled up to it.
 */
function titleFit(x: Ctx, w: number, fs: number, cw: number, maxLines: number, grow?: number): { fs: number; lines: number } {
  const n = Math.max(1, x.title.length);
  const size = grow && n * cw * grow <= w ? Math.min(grow, w / (n * cw)) : fs;
  const per = Math.max(1, Math.floor(w / (size * cw)));
  return { fs: Math.round(size), lines: Math.min(maxLines, Math.max(1, Math.ceil(n / per))) };
}

interface Zone { media: { x: number; y: number; size: number }; info: { x: number; y: number; w: number } }
/**
 * Splits the canvas into a square media area (`size`, optionally part of a wider group `span`×size) and an info area:
 * stacked top/bottom on portrait and square canvases, side by side on landscape.
 */
function zone(x: Ctx, infoH: number, o: { cap: number; span?: number; box?: { x: number; w: number }; gap?: number; align?: "left" | "center"; landCap?: number }): Zone {
  const { H, W, s, fs, land } = x;
  const span = o.span ?? 1, box = o.box ?? { x: s.side, w: x.innerW };
  const availH = H - s.top - s.bottom;
  if (land) {
    const size = Math.max(120, Math.min(availH, (box.w * (o.landCap ?? 0.42)) / span));
    const ix = box.x + size * span + W * 0.06;
    return { media: { x: box.x, y: (H - size) / 2, size }, info: { x: ix, y: Math.max(s.top, H / 2 - infoH / 2), w: box.x + box.w - ix } };
  }
  const gap = o.gap ?? fs(48);
  const size = Math.max(120, Math.min((box.w * o.cap) / span, availH - infoH - gap));
  const y0 = s.top + Math.max(0, (availH - (size + gap + infoH)) / 2);
  const gx = o.align === "left" ? box.x : box.x + (box.w - size * span) / 2;
  return { media: { x: gx, y: y0, size }, info: { x: box.x, y: y0 + size + gap, w: box.w } };
}

const shape = (name: string, r: [number, number, number, number], kind: "rect" | "ellipse" | "ring" | "glow", color: string, over: Partial<StoryElement> = {}, extra: { thickness?: number; radius?: number } = {}) =>
  mk("shape", name, r, { shape: { kind, color, thickness: extra.thickness ?? 4, radius: extra.radius ?? 0 }, ...over });

// ---------- presets ----------

export function buildElementsV1(preset: Preset, aspect: AspectId, c: Colors, title = ""): StoryElement[] {
  uid = 0;
  const x = ctxOf(aspect, c, title);
  const { fs, land, W, H, s } = x;
  const out: StoryElement[] = [];

  if (preset === "classic") {
    const tf = titleFit(x, x.innerW * (land ? 0.5 : 1), fs(land ? 72 : 66), 0.62, 2);
    const o: InfoOpts = { align: land ? "left" : "center", kicker: "Now playing", titleFs: tf.fs, titleFont: "Manrope", titleWeight: 800, titleLines: tf.lines, artistFs: fs(land ? 42 : 40), artistFont: "Manrope", artistWeight: 500, barColor: c.accent, ctl: true, timeFont: "Manrope" };
    const z = zone(x, infoHeight(x, o), { cap: 0.86 });
    const m = z.media, gl = m.size * 1.7;
    out.push(shape("Glow", [m.x + m.size / 2 - gl / 2, m.y + m.size / 2 - gl / 2, gl, gl], "glow", c.accent, { opacity: 0.42, idle: "breathe" }));
    out.push(mk("cover", "Cover", [m.x, m.y, m.size, m.size], { shadow: 80, idle: "float", reactive: 0.35, in: anim("scale", 0, 900) }));
    out.push(...infoBlock(x, o, z.info.x, z.info.y, z.info.w));
    return out;
  }

  if (preset === "glass") {
    const pad = fs(48);
    const box = { x: s.side + pad, w: x.innerW - pad * 2 };
    const tf = titleFit(x, box.w * (land ? 0.5 : 1), fs(land ? 64 : 58), 0.62, 2);
    const o: InfoOpts = { align: "left", titleFs: tf.fs, titleFont: "Manrope", titleWeight: 800, titleLines: tf.lines, artistFs: fs(38), artistFont: "Manrope", artistWeight: 500, barColor: "#ffffff", trackOpacity: 0.22, ctl: true, timeFont: "Manrope" };
    const z = zone(x, infoHeight(x, o), { cap: 1, box, gap: fs(40), landCap: 0.4 });
    const top = z.media.y - pad, bottom = (land ? z.media.y + z.media.size : z.info.y + infoHeight(x, o)) + pad;
    const d = Math.min(W, H) * 0.7;
    out.push(shape("Ring A", [W * 0.62, H * 0.06, d, d], "ring", hueShift(c.accent, 30), { opacity: 0.25, idle: "spin" }, { thickness: 3 }));
    out.push(shape("Ring B", [-d * 0.3, H - d * 0.7, d, d], "ring", hueShift(c.accent, -40), { opacity: 0.22, idle: "spin" }, { thickness: 3 }));
    out.push(mk("panel", "Panel", [s.side, top, x.innerW, bottom - top], { panel: { fill: "#ffffff", fillOpacity: 0.1, blur: 40, radius: fs(64), borderOpacity: 0.22 }, in: anim("scale", 0, 900) }));
    out.push(mk("cover", "Cover", [z.media.x, z.media.y, z.media.size, z.media.size], { shadow: 60, in: anim("scale", 150, 800), idle: "float" }));
    out.push(...infoBlock(x, o, z.info.x, z.info.y, z.info.w, 250));
    return out;
  }

  if (preset === "cover-first") {
    const tf = titleFit(x, x.innerW * (land ? 0.5 : 1), fs(land ? 70 : 62), 0.64, 2);
    const o: InfoOpts = { align: "left", kicker: "{album}", kickerColor: c.accent, titleFs: tf.fs, titleFont: "Playfair Display", titleWeight: 700, titleLines: tf.lines, artistFs: fs(30), artistFont: "JetBrains Mono", artistWeight: 500, artistUpper: true, artistLS: 3, barH: 4, barColor: c.accent, trackOpacity: 0.3, timeFont: "JetBrains Mono", timeFs: 26 };
    const z = zone(x, infoHeight(x, o), { cap: 0.98, span: 1.3, align: "left", landCap: 0.5 });
    const m = z.media, gl = m.size * 1.6;
    out.push(shape("Glow", [m.x + m.size * 0.65 - gl / 2, m.y + m.size / 2 - gl / 2, gl, gl], "glow", c.accent, { opacity: 0.2 }));
    out.push(mk("cover", "Cover", [m.x, m.y, m.size, m.size], { coverStyle: "vinyl", shadow: 60, in: anim("slide-up", 0, 900) }));
    out.push(...infoBlock(x, o, z.info.x, z.info.y, z.info.w));
    return out;
  }

  if (preset === "minimal") {
    const tf = titleFit(x, x.innerW * (land ? 0.55 : 1), fs(land ? 120 : 176), 0.56, land ? 2 : 4, fs(land ? 260 : 330));
    const o: InfoOpts = { align: "left", titleFs: tf.fs, titleFont: "Oswald", titleWeight: 700, titleLines: tf.lines, titleUpper: true, titleLS: -1, titleLH: 0.95, artistFs: fs(46), artistFont: "Oswald", artistWeight: 400, artistUpper: true, artistLS: 6, barH: 6, barColor: c.accent, trackOpacity: 0.25, timeFont: "Oswald", timeFs: 34 };
    const z = zone(x, infoHeight(x, o), { cap: 0.5, align: "left", gap: fs(60), landCap: 0.34 });
    const m = z.media, rowH = fs(land ? 200 : 260), rowFs = fs(land ? 190 : 250);
    const row = (name: string, y: number, speed: number) => mk("text", name, [0, y, W, rowH], { content: "{artist}  {title}", text: text({ fontFamily: "Oswald", fontSize: rowFs, fontWeight: 700, color: c.text, outline: true, scroll: speed, maxLines: 1, uppercase: true, lineHeight: 1 }), opacity: 0.2 });
    out.push(row("Marquee top", fs(40), fs(120)));
    const infoBottom = z.info.y + infoHeight(x, o), bottomY = H - rowH - fs(40);
    if (infoBottom + fs(24) < bottomY + rowH * 0.2) out.push(row("Marquee bottom", bottomY, -fs(120))); // only where it won't sit on the player
    out.push(shape("Block", [m.x + fs(26), m.y + fs(26), m.size, m.size], "rect", c.accent, { in: anim("slide-up", 60, 800) }));
    out.push(mk("cover", "Cover", [m.x, m.y, m.size, m.size], { shadow: 0, rotation: -3, idle: "sway", in: anim("scale", 0, 800) }));
    out.push(...infoBlock(x, o, z.info.x, z.info.y, z.info.w));
    return out;
  }

  if (preset === "visualizer") {
    const tf = titleFit(x, x.innerW * (land ? 0.5 : 1), fs(land ? 66 : 60), 0.8, 2);
    const o: InfoOpts = { align: land ? "left" : "center", titleFs: tf.fs, titleFont: "Unbounded", titleWeight: 600, titleLines: tf.lines, artistFs: fs(36), artistFont: "Inter", artistWeight: 500, barH: 6, barColor: c.accent, trackOpacity: 0.2, timeFs: 28 };
    const z = zone(x, infoHeight(x, o), { cap: 1, gap: fs(20), landCap: 0.5 });
    const m = z.media, ring = m.size, disc = ring * 0.225; // disc radius: leaves the bars (which start at r = 0.24 of the ring) a small gap
    const cx = m.x + ring / 2, cy = m.y + ring / 2, gl = ring * 1.2;
    out.push(shape("Glow", [cx - gl / 2, cy - gl / 2, gl, gl], "glow", c.accent, { opacity: 0.3, idle: "breathe" }));
    out.push(mk("visualizer", "Ring", [m.x, m.y, ring, ring], { vis: { ...DEFAULT_VIS, style: "radial", bars: 56, color: c.accent, gap: 0.45, sensitivity: 1.3 }, in: anim("fade", 200, 900) }));
    out.push(mk("cover", "Cover", [cx - disc, cy - disc, disc * 2, disc * 2], { coverStyle: "disc", shadow: 50, reactive: 0.5, in: anim("scale", 0, 900) }));
    out.push(...infoBlock(x, o, z.info.x, z.info.y, z.info.w, 300));
    return out;
  }

  // polaroid
  const o: InfoOpts = { align: "center", titleFs: fs(1), titleFont: "Inter", titleWeight: 600, titleLines: 1, artistFs: fs(1), artistFont: "Inter", artistWeight: 500, barH: 6, barColor: c.accent, trackOpacity: 0.28, timeFs: 28 };
  // The caption lives on the card itself, so below it there is only the progress bar and the times.
  const below = fs(34) + 6 + fs(14) + fs(28) * 1.3;
  const cardW = (size: number) => size, cardH = (size: number) => size * 1.26;
  const zz = zone(x, below, { cap: 0.86, gap: fs(70), landCap: 0.36 });
  const size = land ? (H - s.top - s.bottom) * 0.8 / 1.26 : Math.min(zz.media.size, (H - s.top - s.bottom - below - fs(70)) / 1.26);
  const cw = cardW(size), ch = cardH(size);
  const cx0 = land ? W * 0.1 : (W - cw) / 2, cy0 = land ? (H - ch) / 2 : s.top + Math.max(0, (H - s.top - s.bottom - (ch + fs(70) + below)) / 2);
  out.push(mk("shape", "Print back", [cx0, cy0, cw, ch], { shape: { kind: "rect", color: "#d9d4c7", thickness: 1, radius: 6 }, rotation: 6, shadow: 0, in: anim("scale", 0, 800) }));
  out.push(mk("shape", "Print mid", [cx0, cy0, cw, ch], { shape: { kind: "rect", color: "#ebe6d9", thickness: 1, radius: 6 }, rotation: -4, in: anim("scale", 80, 800) }));
  out.push(mk("cover", "Cover", [cx0, cy0, cw, ch], { coverStyle: "polaroid", shadow: 60, rotation: 1.5, idle: "sway", in: anim("scale", 160, 900) }));
  out.push(shape("Tape", [cx0 + cw / 2 - fs(90), cy0 - fs(28), fs(180), fs(56)], "rect", hueShift(c.accent, 0, 0.7), { rotation: -7, opacity: 0.78, in: anim("fade", 700) }, { radius: 3 }));
  if (land) {
    const lx = cx0 + cw + W * 0.09, lw = W - s.side - lx;
    const tf = titleFit(x, lw, fs(76), 0.6, 3);
    const lo: InfoOpts = { align: "left", titleFs: tf.fs, titleFont: "Playfair Display", titleWeight: 700, titleLines: tf.lines, artistFs: fs(36), artistFont: "JetBrains Mono", artistWeight: 500, artistUpper: true, artistLS: 3, barH: 6, barColor: c.accent, trackOpacity: 0.28, timeFont: "JetBrains Mono", timeFs: 26 };
    out.push(...infoBlock(x, lo, lx, Math.max(s.top, H / 2 - infoHeight(x, lo) / 2), lw, 400));
    return out;
  }
  const bx = land ? cx0 + cw + W * 0.07 : s.side, bw = land ? W - s.side - bx : x.innerW, by = land ? H / 2 - below / 2 : cy0 + ch + fs(70);
  out.push(mk("progress", "Progress", [bx, by + fs(34) / 2, bw, 6], { bar: { color: c.accent, trackColor: c.text, trackOpacity: 0.28, rounded: true }, in: anim("fade", 500) }));
  const ts = (align: "left" | "right") => text({ fontFamily: "JetBrains Mono", fontSize: fs(28), color: c.text, fontWeight: 500, align, maxLines: 1 });
  out.push(mk("time", "Elapsed", [bx, by + fs(34) / 2 + 6 + fs(14), bw / 2, fs(28) * 1.3], { timeKind: "elapsed", text: ts("left"), opacity: 0.7, in: anim("fade", 550) }));
  out.push(mk("time", "Total", [bx + bw / 2, by + fs(34) / 2 + 6 + fs(14), bw / 2, fs(28) * 1.3], { timeKind: "total", text: ts("right"), opacity: 0.7, in: anim("fade", 550) }));
  void o;
  return out;
}

export function defaultBackgroundV1(preset: Preset, c: Colors): Background {
  const dark = luma(c.bg) < 0.5 ? c.bg : "#101010";
  switch (preset) {
    case "classic": return { type: "art", blur: 55, zoom: 1.35, brightness: 58, saturation: 125, overlay: c.bg, overlayOpacity: 0.3, drift: 0.7 };
    case "glass": return { type: "aurora", base: shade(dark, -0.55), colors: [c.accent, hueShift(c.accent, 38), hueShift(c.accent, -42)], speed: 1 };
    case "visualizer": return { type: "aurora", base: shade(dark, -0.75), colors: [hueShift(c.accent, 0), hueShift(c.accent, 70), hueShift(c.accent, -60)], speed: 0.8 };
    case "cover-first": return { type: "gradient", from: mix(dark, c.accent, 0.38), to: shade(mix(dark, c.accent, 0.1), -0.6), angle: 160, motion: 2 };
    case "polaroid": return { type: "gradient", from: shade(dark, 0.12), to: shade(dark, -0.5), angle: 200, motion: 0 };
    default: return { type: "solid", color: c.bg };
  }
}

export function defaultEffectsV1(preset: Preset): Project["effects"] {
  switch (preset) {
    case "classic": return { vignette: 35, grain: 18 };
    case "glass": return { vignette: 20, grain: 14 };
    case "cover-first": return { vignette: 45, grain: 38 };
    case "visualizer": return { vignette: 40, grain: 12 };
    case "polaroid": return { vignette: 30, grain: 30 };
    default: return { vignette: 0, grain: 22 };
  }
}
