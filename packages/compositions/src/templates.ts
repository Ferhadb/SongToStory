import { NO_ANIM } from "./animations";
import { hueShift, luma, mix, safeArea, shade, type Safe } from "./kit";
import { fitText } from "./measure";
import { playerHeight } from "./photo";
import { typePairOf, type TypePair, type TypeRole } from "./typography";
import { buildElementsV1, defaultBackgroundV1, defaultEffectsV1, type Colors, type Preset as PresetV1 } from "./templates-v1";
import { DEFAULT_VIS } from "./Visualizer";
import {
  ASPECTS, SCHEMA_VERSION, TEMPLATE_VERSION, templateVersionOf,
  type AspectId, type Background, type PlayerSettings, type Project, type StoryElement, type TextStyle,
} from "./schema";

export interface TemplateInfo { id: string; name: string; description: string }
export const TEMPLATES: TemplateInfo[] = [
  { id: "classic", name: "Now Playing", description: "Glowing cover over a slowly pushing-in blurred backdrop." },
  { id: "glass", name: "Aurora Glass", description: "Drifting aurora light behind a frosted player card." },
  { id: "cover-first", name: "Vinyl Sleeve", description: "A sleeve with a spinning record sliding out." },
  { id: "minimal", name: "Type Poster", description: "Giant condensed type and scrolling outlined lettering." },
  { id: "visualizer", name: "Spectrum Ring", description: "A spinning disc ringed by a live audio spectrum." },
  { id: "polaroid", name: "Instant Print", description: "A clean instant print with the song written underneath." },
  { id: "lyrics", name: "Lyrics", description: "Big synced lyrics, line by line, under a compact song header." },
  { id: "photo-story", name: "Photo Story", description: "Your own photo with a music player card over it." },
];

export const FONTS = ["Inter", "Manrope", "Playfair Display", "Unbounded", "Oswald", "JetBrains Mono", "Fraunces"] as const;
/** Fraunces has no Cyrillic glyphs. */
export const LATIN_ONLY_FONTS: readonly string[] = ["Fraunces"];

export type Preset = PresetV1 | "photo-story" | "lyrics";
export type { Colors, Safe };

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

const shape = (name: string, r: [number, number, number, number], kind: "rect" | "ellipse" | "ring" | "glow", color: string, over: Partial<StoryElement> = {}, extra: { thickness?: number; radius?: number } = {}) =>
  mk("shape", name, r, { shape: { kind, color, thickness: extra.thickness ?? 4, radius: extra.radius ?? 0 }, ...over });

// ---------- layout ----------

interface Ctx { title: string; artist: string; W: number; H: number; land: boolean; s: Safe; innerW: number; fs: (n: number) => number; c: Colors }
function ctxOf(aspect: AspectId, c: Colors, title: string, artist: string): Ctx {
  const { w: W, h: H } = ASPECTS[aspect];
  const s = safeArea(aspect);
  const land = W > H;
  const scale = land ? H / 1080 : W / 1080; // type scale relative to a 1080-short-edge canvas
  return { title, artist, W, H, land, s, innerW: W - s.side * 2, fs: (n) => Math.round(n * scale), c };
}

/** A font role as a template wants it; a chosen type pair replaces font, weight, case and tracking wholesale. */
interface Role { font: string; weight: number; upper?: boolean; /** em */ track?: number }
const role = (def: Role, pair: TypeRole | undefined): Role =>
  pair ? { font: pair.font, weight: pair.weight, upper: !!pair.upper, track: pair.track ?? 0 } : def;

interface InfoOpts {
  align: TextStyle["align"];
  kicker?: string; kickerColor?: string;
  title: Role & { lh: number; maxFs: number; minFs: number; maxLines: number };
  artist: Role & { fs: number };
  time: Role & { fs: number };
  barH: number; barColor: string; trackOpacity: number;
  ctl?: boolean; color?: string;
}

interface InfoPlan {
  tf: { size: number; lines: number }; af: { size: number };
  titleH: number; artistH: number; timeFs: number; timeH: number; kickerH: number; kickerGap: number;
  gapTA: number; gapAB: number; gapBT: number; gapTC: number; ctlH: number; height: number;
}

/** Sizes every row of the info stack from the real title/artist text; `height` is exactly what `infoBlock` then lays out. */
function planInfo(x: Ctx, o: InfoOpts, w: number): InfoPlan {
  const { fs } = x;
  const t = o.title, a = o.artist;
  // Prefer a comfortable size on the usual number of lines; only a title too long for that gets one more line (down to minFs).
  const budget = (x.H - x.s.top - x.s.bottom) * (x.land ? 0.6 : 0.42);
  const req = { font: t.font, maxW: w, maxSize: t.maxFs, weight: t.weight, upper: t.upper, tracking: t.track, maxH: budget, lineHeight: t.lh };
  let tf = fitText(x.title || " ", { ...req, maxLines: t.maxLines, minSize: Math.max(t.minFs, t.maxFs * 0.55) });
  if (!tf.fits) tf = fitText(x.title || " ", { ...req, maxLines: t.maxLines + 1, minSize: t.minFs });
  const af = fitText(x.artist || " ", { font: a.font, maxW: w, maxLines: 1, maxSize: a.fs, minSize: Math.round(a.fs * 0.66), weight: a.weight, upper: a.upper, tracking: a.track });
  const kickerH = o.kicker ? fs(28) : 0, kickerGap = o.kicker ? fs(22) : 0;
  const titleH = Math.round(tf.lines * tf.size * t.lh);
  const artistH = Math.round(af.size * 1.35);
  const timeFs = fs(o.time.fs), timeH = Math.round(timeFs * 1.3);
  const gapTA = fs(14), gapAB = fs(44), gapBT = fs(16), gapTC = fs(40), ctlH = fs(96);
  const height = kickerH + kickerGap + titleH + gapTA + artistH + gapAB + o.barH + gapBT + timeH + (o.ctl ? gapTC + ctlH : 0);
  return { tf, af, titleH, artistH, timeFs, timeH, kickerH, kickerGap, gapTA, gapAB, gapBT, gapTC, ctlH, height };
}

/** kicker / title / artist / progress / times / controls, stacked from (px, y) across width w. */
function infoBlock(x: Ctx, o: InfoOpts, pl: InfoPlan, px: number, y: number, w: number, t0 = 150): StoryElement[] {
  const { fs, c } = x;
  const col = o.color ?? c.text;
  const out: StoryElement[] = [];
  if (o.kicker) {
    out.push(mk("text", "Kicker", [px, y, w, pl.kickerH], { content: o.kicker, text: text({ fontFamily: "Inter", fontSize: fs(22), fontWeight: 700, letterSpacing: 5, uppercase: true, color: o.kickerColor ?? c.accent, align: o.align, maxLines: 1 }), in: anim("fade", t0 - 100) }));
    y += pl.kickerH + pl.kickerGap;
  }
  const t = o.title, a = o.artist;
  out.push(mk("title", "Title", [px, y, w, pl.titleH], {
    text: text({ fontFamily: t.font, fontSize: pl.tf.size, fontWeight: t.weight, color: col, align: o.align, maxLines: pl.tf.lines, uppercase: !!t.upper, letterSpacing: Math.round((t.track ?? 0) * pl.tf.size * 10) / 10, lineHeight: t.lh, valign: "bottom", balance: true }),
    in: anim("slide-up", t0),
  }));
  y += pl.titleH + pl.gapTA;
  out.push(mk("artist", "Artist", [px, y, w, pl.artistH], {
    text: text({ fontFamily: a.font, fontSize: pl.af.size, fontWeight: a.weight, color: col, align: o.align, maxLines: 1, uppercase: !!a.upper, letterSpacing: Math.round((a.track ?? 0) * pl.af.size * 10) / 10 }),
    opacity: 0.74, in: anim("slide-up", t0 + 100),
  }));
  y += pl.artistH + pl.gapAB;
  out.push(mk("progress", "Progress", [px, y, w, o.barH], { bar: { color: o.barColor, trackColor: col, trackOpacity: o.trackOpacity, rounded: true }, in: anim("fade", t0 + 250) }));
  y += o.barH + pl.gapBT;
  const tm = o.time;
  const ts = (align: "left" | "right") => text({ fontFamily: tm.font, fontSize: pl.timeFs, color: col, fontWeight: tm.weight, align, maxLines: 1 });
  out.push(mk("time", "Elapsed", [px, y, w / 2, pl.timeH], { timeKind: "elapsed", text: ts("left"), opacity: 0.7, in: anim("fade", t0 + 300) }));
  out.push(mk("time", "Total", [px + w / 2, y, w / 2, pl.timeH], { timeKind: "total", text: ts("right"), opacity: 0.7, in: anim("fade", t0 + 300) }));
  if (o.ctl) {
    y += pl.timeH + pl.gapTC;
    out.push(mk("controls", "Controls", [px + w / 2 - fs(190), y, fs(380), pl.ctlH], { ctl: { color: col }, in: anim("fade", t0 + 450) }));
  }
  return out;
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
  const gap = o.gap ?? fs(56);
  const size = Math.max(120, Math.min((box.w * o.cap) / span, availH - infoH - gap));
  const y0 = s.top + Math.max(0, (availH - (size + gap + infoH)) / 2);
  const gx = o.align === "left" ? box.x : box.x + (box.w - size * span) / 2;
  return { media: { x: gx, y: y0, size }, info: { x: box.x, y: y0 + size + gap, w: box.w } };
}

/** Plans the info stack at the width the zone gives it, then sizes the zone around that stack's real height. */
function place(x: Ctx, o: InfoOpts, zo: Parameters<typeof zone>[2], firstW: number): { z: Zone; pl: InfoPlan } {
  const z0 = zone(x, planInfo(x, o, firstW).height, zo);
  const pl = planInfo(x, o, z0.info.w);
  return { z: zone(x, pl.height, zo), pl };
}

// ---------- presets ----------

export interface BuildOpts {
  /** Template design version; absent means the current one. Version 1 is the frozen original layouts. */
  version?: number;
  artist?: string;
  /** Curated typography (see TYPE_PAIRS). */
  pair?: string;
  /** Existing player settings to keep when re-laying out a Photo Story. */
  player?: PlayerSettings | null;
}

export function buildElements(preset: Preset, aspect: AspectId, c: Colors, title = "", opts: BuildOpts = {}): StoryElement[] {
  const version = opts.version ?? TEMPLATE_VERSION;
  if (version < 2 && preset !== "photo-story" && preset !== "lyrics") return buildElementsV1(preset, aspect, c, title);
  uid = 0;
  const x = ctxOf(aspect, c, title, opts.artist ?? "");
  const { fs, land, W, H, s } = x;
  const pair = typePairOf(opts.pair);
  const heading = pair?.heading, body = pair?.body;
  const out: StoryElement[] = [];
  const barH = 8;

  if (preset === "classic") {
    const o: InfoOpts = {
      align: land ? "left" : "center", kicker: "Now playing",
      title: { ...role({ font: "Manrope", weight: 800, track: -0.02 }, heading), lh: 1.06, maxFs: fs(land ? 76 : 70), minFs: fs(34), maxLines: 2 },
      artist: { ...role({ font: "Manrope", weight: 500 }, body), fs: fs(land ? 40 : 38) },
      time: { ...role({ font: "Manrope", weight: 500 }, body), fs: 28 },
      barH, barColor: c.accent, trackOpacity: 0.26, ctl: true,
    };
    const { z, pl } = place(x, o, { cap: 0.8 }, x.innerW * (land ? 0.5 : 1));
    const m = z.media, gl = m.size * 1.7;
    out.push(shape("Glow", [m.x + m.size / 2 - gl / 2, m.y + m.size / 2 - gl / 2, gl, gl], "glow", c.accent, { opacity: 0.42, idle: "breathe" }));
    out.push(mk("cover", "Cover", [m.x, m.y, m.size, m.size], { shadow: 80, idle: "float", reactive: 0.35, in: anim("scale", 0, 900) }));
    out.push(...infoBlock(x, o, pl, z.info.x, z.info.y, z.info.w));
    return out;
  }

  if (preset === "glass") {
    const pad = fs(52);
    const box = { x: s.side + pad, w: x.innerW - pad * 2 };
    const o: InfoOpts = {
      align: "left",
      title: { ...role({ font: "Manrope", weight: 800, track: -0.02 }, heading), lh: 1.06, maxFs: fs(land ? 62 : 58), minFs: fs(32), maxLines: 2 },
      artist: { ...role({ font: "Manrope", weight: 500 }, body), fs: fs(36) },
      time: { ...role({ font: "Manrope", weight: 500 }, body), fs: 28 },
      barH, barColor: "#ffffff", trackOpacity: 0.22, ctl: true,
    };
    const { z, pl } = place(x, o, { cap: 1, box, gap: fs(44), landCap: 0.4 }, box.w * (land ? 0.5 : 1));
    const top = z.media.y - pad, bottom = (land ? z.media.y + z.media.size : z.info.y + pl.height) + pad;
    const d = Math.min(W, H) * 0.7;
    out.push(shape("Ring A", [W * 0.62, H * 0.06, d, d], "ring", hueShift(c.accent, 30), { opacity: 0.25, idle: "spin" }, { thickness: 3 }));
    out.push(shape("Ring B", [-d * 0.3, H - d * 0.7, d, d], "ring", hueShift(c.accent, -40), { opacity: 0.22, idle: "spin" }, { thickness: 3 }));
    out.push(mk("panel", "Panel", [s.side, top, x.innerW, bottom - top], { panel: { fill: "#ffffff", fillOpacity: 0.1, blur: 40, radius: fs(64), borderOpacity: 0.22 }, in: anim("scale", 0, 900) }));
    out.push(mk("cover", "Cover", [z.media.x, z.media.y, z.media.size, z.media.size], { shadow: 60, in: anim("scale", 150, 800), idle: "float" }));
    out.push(...infoBlock(x, o, pl, z.info.x, z.info.y, z.info.w, 250));
    return out;
  }

  if (preset === "cover-first") {
    const o: InfoOpts = {
      align: "left", kicker: "{album}", kickerColor: c.accent,
      title: { ...role({ font: "Playfair Display", weight: 700, track: -0.01 }, heading), lh: 1.1, maxFs: fs(land ? 70 : 64), minFs: fs(32), maxLines: 2 },
      artist: { ...role({ font: "JetBrains Mono", weight: 500, upper: true, track: 0.1 }, body), fs: fs(28) },
      time: { ...role({ font: "JetBrains Mono", weight: 500 }, body), fs: 24 },
      barH: 4, barColor: c.accent, trackOpacity: 0.3,
    };
    const { z, pl } = place(x, o, { cap: 0.98, span: 1.3, align: "left", landCap: 0.5 }, x.innerW * (land ? 0.5 : 1));
    const m = z.media, gl = m.size * 1.6;
    out.push(shape("Glow", [m.x + m.size * 0.65 - gl / 2, m.y + m.size / 2 - gl / 2, gl, gl], "glow", c.accent, { opacity: 0.2 }));
    out.push(mk("cover", "Cover", [m.x, m.y, m.size, m.size], { coverStyle: "vinyl", shadow: 60, in: anim("slide-up", 0, 900) }));
    out.push(...infoBlock(x, o, pl, z.info.x, z.info.y, z.info.w));
    return out;
  }

  if (preset === "minimal") {
    const o: InfoOpts = {
      align: "left",
      title: { ...role({ font: "Oswald", weight: 700, upper: true, track: -0.01 }, heading), lh: 0.96, maxFs: fs(land ? 190 : 320), minFs: fs(land ? 56 : 64), maxLines: land ? 3 : 4 },
      artist: { ...role({ font: "Oswald", weight: 400, upper: true, track: 0.12 }, body), fs: fs(46) },
      time: { ...role({ font: "Oswald", weight: 400, upper: true, track: 0.04 }, body), fs: 34 },
      barH: 6, barColor: c.accent, trackOpacity: 0.25,
    };
    const { z, pl } = place(x, o, { cap: 0.5, align: "left", gap: fs(60), landCap: 0.34 }, x.innerW * (land ? 0.55 : 1));
    const m = z.media, rowH = fs(land ? 200 : 260), rowFs = fs(land ? 190 : 250);
    const row = (name: string, y: number, speed: number) => mk("text", name, [0, y, W, rowH], { content: "{artist}  {title}", text: text({ fontFamily: "Oswald", fontSize: rowFs, fontWeight: 700, color: c.text, outline: true, scroll: speed, maxLines: 1, uppercase: true, lineHeight: 1 }), opacity: 0.2 });
    out.push(row("Marquee top", fs(40), fs(120)));
    const infoBottom = z.info.y + pl.height, bottomY = H - rowH - fs(40);
    if (infoBottom + fs(24) < bottomY + rowH * 0.2) out.push(row("Marquee bottom", bottomY, -fs(120))); // only where it won't sit on the player
    out.push(shape("Block", [m.x + fs(26), m.y + fs(26), m.size, m.size], "rect", c.accent, { in: anim("slide-up", 60, 800) }));
    out.push(mk("cover", "Cover", [m.x, m.y, m.size, m.size], { shadow: 0, rotation: -3, idle: "sway", in: anim("scale", 0, 800) }));
    out.push(...infoBlock(x, o, pl, z.info.x, z.info.y, z.info.w));
    return out;
  }

  if (preset === "visualizer") {
    const o: InfoOpts = {
      align: land ? "left" : "center",
      title: { ...role({ font: "Unbounded", weight: 500, track: -0.01 }, heading), lh: 1.16, maxFs: fs(land ? 56 : 52), minFs: fs(28), maxLines: 2 },
      artist: { ...role({ font: "Inter", weight: 600, upper: true, track: 0.14 }, body), fs: fs(26) },
      time: { ...role({ font: "Inter", weight: 500 }, body), fs: 26 },
      barH: 6, barColor: c.accent, trackOpacity: 0.2,
    };
    const { z, pl } = place(x, o, { cap: 1, gap: fs(28), landCap: 0.5 }, x.innerW * (land ? 0.5 : 1));
    const m = z.media, ring = m.size, disc = ring * 0.225; // disc radius: leaves the bars (which start at r = 0.24 of the ring) a small gap
    const cx = m.x + ring / 2, cy = m.y + ring / 2, gl = ring * 1.2;
    out.push(shape("Glow", [cx - gl / 2, cy - gl / 2, gl, gl], "glow", c.accent, { opacity: 0.3, idle: "breathe" }));
    out.push(mk("visualizer", "Ring", [m.x, m.y, ring, ring], { vis: { ...DEFAULT_VIS, style: "radial", bars: 56, color: c.accent, gap: 0.45, sensitivity: 1.3 }, in: anim("fade", 200, 900) }));
    out.push(mk("cover", "Cover", [cx - disc, cy - disc, disc * 2, disc * 2], { coverStyle: "disc", shadow: 50, reactive: 0.5, in: anim("scale", 0, 900) }));
    out.push(...infoBlock(x, o, pl, z.info.x, z.info.y, z.info.w, 300));
    return out;
  }

  if (preset === "lyrics") {
    // compact header (cover + title + artist), the lyrics filling the middle, progress at the foot
    const cs = fs(140), gx = fs(28), tx = s.side + cs + gx, tw = x.innerW - cs - gx;
    const tr = role({ font: "Manrope", weight: 800, track: -0.02 }, heading), ar = role({ font: "Manrope", weight: 500 }, body);
    const tf = fitText(x.title || " ", { font: tr.font, maxW: tw, maxLines: 2, maxSize: fs(48), minSize: fs(28), weight: tr.weight, upper: tr.upper, tracking: tr.track, lineHeight: 1.1 });
    const af = fitText(x.artist || " ", { font: ar.font, maxW: tw, maxLines: 1, maxSize: fs(32), minSize: fs(22), weight: ar.weight, upper: ar.upper, tracking: ar.track });
    const titleH = Math.round(tf.lines * tf.size * 1.1), artistH = Math.round(af.size * 1.35), gap = fs(8);
    const ty = s.top + (cs - (titleH + gap + artistH)) / 2;
    out.push(mk("cover", "Cover", [s.side, s.top, cs, cs], { shadow: 40, in: anim("scale", 0, 700) }));
    out.push(mk("title", "Title", [tx, ty, tw, titleH], {
      text: text({ fontFamily: tr.font, fontSize: tf.size, fontWeight: tr.weight, color: c.text, align: "left", maxLines: tf.lines, uppercase: !!tr.upper, letterSpacing: Math.round((tr.track ?? 0) * tf.size * 10) / 10, lineHeight: 1.1, valign: "bottom" }),
      in: anim("fade", 100),
    }));
    out.push(mk("artist", "Artist", [tx, ty + titleH + gap, tw, artistH], {
      text: text({ fontFamily: ar.font, fontSize: af.size, fontWeight: ar.weight, color: c.text, align: "left", maxLines: 1, uppercase: !!ar.upper, letterSpacing: Math.round((ar.track ?? 0) * af.size * 10) / 10 }),
      opacity: 0.74, in: anim("fade", 200),
    }));
    const timeFs = fs(26), timeH = Math.round(timeFs * 1.3), footH = barH + fs(16) + timeH;
    const fy = H - s.bottom - footH, ly = s.top + cs + fs(56);
    out.push(mk("lyrics", "Lyrics", [s.side, ly, x.innerW, Math.max(fs(200), fy - fs(56) - ly)], { in: anim("fade", 0, 500) }));
    const tm = role({ font: "Manrope", weight: 500 }, body);
    const ts = (align: "left" | "right") => text({ fontFamily: tm.font, fontSize: timeFs, color: c.text, fontWeight: tm.weight, align, maxLines: 1 });
    out.push(mk("progress", "Progress", [s.side, fy, x.innerW, barH], { bar: { color: c.accent, trackColor: c.text, trackOpacity: 0.26, rounded: true }, in: anim("fade", 300) }));
    out.push(mk("time", "Elapsed", [s.side, fy + barH + fs(16), x.innerW / 2, timeH], { timeKind: "elapsed", text: ts("left"), opacity: 0.7, in: anim("fade", 350) }));
    out.push(mk("time", "Total", [s.side + x.innerW / 2, fy + barH + fs(16), x.innerW / 2, timeH], { timeKind: "total", text: ts("right"), opacity: 0.7, in: anim("fade", 350) }));
    return out;
  }

  if (preset === "photo-story") {
    const player = opts.player ?? { style: "apple" as const, title: null, artist: null, artwork: null };
    const ratio = playerHeight(player.style, 1000) / 1000;
    const bottom = Math.max(s.bottom, fs(60));
    const pw = Math.round(land ? Math.min(x.innerW * 0.46, 900) : x.innerW * (W === H ? 0.92 : 1));
    const ph = Math.round(pw * ratio);
    const px = land ? s.side + W * 0.01 : (W - pw) / 2;
    out.push(mk("player", "Player", [px, H - bottom - ph, pw, ph], { player, shadow: 40, in: anim("slide-up", 100, 800) }));
    return out;
  }

  // polaroid: a clean instant print, caption on the card
  const R = 1.22; // card height / width
  const cap = { ...role({ font: "Manrope", weight: 800, track: -0.02 }, heading) };
  const timeFs = fs(26), timeH = Math.round(timeFs * 1.3);
  const belowH = fs(44) + 8 + fs(16) + timeH;
  const gap = fs(56);
  const captionStyle = text({ fontFamily: cap.font, fontWeight: cap.weight, uppercase: !!cap.upper, letterSpacing: 0, color: "#1c1b19", align: "center" });
  if (land) {
    const ch = Math.round((H - s.top - s.bottom) * 0.88), cw = Math.round(ch / R);
    const cx0 = s.side + W * 0.05, cy0 = (H - ch) / 2;
    out.push(mk("cover", "Cover", [cx0, cy0, cw, ch], { coverStyle: "print", text: captionStyle, shadow: 50, idle: "sway", in: anim("scale", 0, 900) }));
    const lx = cx0 + cw + W * 0.08, lw = W - s.side - lx;
    const o: InfoOpts = {
      align: "left",
      title: { ...role({ font: "Manrope", weight: 800, track: -0.02 }, heading), lh: 1.08, maxFs: fs(74), minFs: fs(32), maxLines: 3 },
      artist: { ...role({ font: "Inter", weight: 500 }, body), fs: fs(36) },
      time: { ...role({ font: "Inter", weight: 500 }, body), fs: 26 },
      barH, barColor: c.accent, trackOpacity: 0.28,
    };
    const pl = planInfo(x, o, lw);
    out.push(...infoBlock(x, o, pl, lx, Math.max(s.top, H / 2 - pl.height / 2), lw, 400));
    return out;
  }
  const availH = H - s.top - s.bottom;
  const cw = Math.round(Math.min(x.innerW * 0.86, (availH - belowH - gap) / R)), ch = Math.round(cw * R);
  const x0 = (W - cw) / 2, y0 = s.top + Math.max(0, (availH - (ch + gap + belowH)) / 2);
  out.push(mk("cover", "Cover", [x0, y0, cw, ch], { coverStyle: "print", text: captionStyle, shadow: 50, idle: "sway", in: anim("scale", 0, 900) }));
  const by = y0 + ch + gap + fs(22);
  const tf = role({ font: "Inter", weight: 500 }, body);
  const ts = (align: "left" | "right") => text({ fontFamily: tf.font, fontSize: timeFs, color: c.text, fontWeight: tf.weight, align, maxLines: 1 });
  out.push(mk("progress", "Progress", [x0, by, cw, 8], { bar: { color: c.accent, trackColor: c.text, trackOpacity: 0.28, rounded: true }, in: anim("fade", 500) }));
  out.push(mk("time", "Elapsed", [x0, by + 8 + fs(16), cw / 2, timeH], { timeKind: "elapsed", text: ts("left"), opacity: 0.7, in: anim("fade", 550) }));
  out.push(mk("time", "Total", [x0 + cw / 2, by + 8 + fs(16), cw / 2, timeH], { timeKind: "total", text: ts("right"), opacity: 0.7, in: anim("fade", 550) }));
  return out;
}

export function defaultBackground(preset: Preset, c: Colors, version = TEMPLATE_VERSION): Background {
  if (preset === "photo-story") return { type: "photo" };
  if (version < 2 && preset !== "lyrics") return defaultBackgroundV1(preset, c);
  const dark = luma(c.bg) < 0.5 ? c.bg : "#101010";
  switch (preset) {
    case "lyrics": return { type: "art", blur: 70, zoom: 1.5, brightness: 66, saturation: 145, overlay: c.bg, overlayOpacity: 0.18, drift: 0.5 };
    case "classic": return { type: "art", blur: 55, zoom: 1.35, brightness: 58, saturation: 125, overlay: c.bg, overlayOpacity: 0.3, drift: 0.7 };
    case "glass": return { type: "aurora", base: shade(dark, -0.55), colors: [c.accent, hueShift(c.accent, 38), hueShift(c.accent, -42)], speed: 1 };
    case "visualizer": return { type: "aurora", base: shade(dark, -0.75), colors: [hueShift(c.accent, 0), hueShift(c.accent, 70), hueShift(c.accent, -60)], speed: 0.8 };
    case "cover-first": return { type: "gradient", from: mix(dark, c.accent, 0.38), to: shade(mix(dark, c.accent, 0.1), -0.6), angle: 160, motion: 2 };
    case "polaroid": return { type: "gradient", from: mix(shade(dark, 0.1), c.accent, 0.12), to: shade(dark, -0.55), angle: 190, motion: 0 };
    default: return { type: "solid", color: c.bg };
  }
}

export function defaultEffects(preset: Preset, version = TEMPLATE_VERSION): Project["effects"] {
  if (preset === "photo-story") return { vignette: 22, grain: 6 };
  if (version < 2 && preset !== "lyrics") return defaultEffectsV1(preset);
  switch (preset) {
    case "classic": return { vignette: 35, grain: 18 };
    case "lyrics": return { vignette: 30, grain: 12 };
    case "glass": return { vignette: 20, grain: 14 };
    case "cover-first": return { vignette: 45, grain: 38 };
    case "visualizer": return { vignette: 40, grain: 12 };
    case "polaroid": return { vignette: 30, grain: 16 };
    default: return { vignette: 0, grain: 22 };
  }
}

export { shade, hueShift };

// ---------- projects ----------

export interface NewProjectInput {
  id: string;
  track: Project["track"];
  audio?: Partial<Project["audio"]>;
  artwork: Project["artwork"];
  theme: { background: string; text: string; accent: string };
  aspect?: AspectId;
  templateId?: string;
  fallbackDurationMs?: number;
}

const presetOf = (id: string): Preset => (TEMPLATES.some((t) => t.id === id) ? id : "classic") as Preset;
const colorsOf = (p: Pick<Project, "theme">): Colors => ({ text: p.theme.text, accent: p.theme.accent, bg: p.theme.background });
const artistOf = (p: Pick<Project, "track">) => p.track.artists.join(", ");

/** What the project's template generates for its current track text, format, version and typography. */
function layoutOf(p: Project, over: { aspect?: AspectId; pair?: string | undefined; track?: Project["track"] } = {}): StoryElement[] {
  const track = over.track ?? p.track;
  const player = p.elements.find((e) => e.type === "player")?.player ?? null;
  return buildElements(presetOf(p.templateId), over.aspect ?? p.canvas.aspect, colorsOf(p), track.title, {
    version: templateVersionOf(p), artist: track.artists.join(", "), pair: "pair" in over ? over.pair : p.typePair, player,
  });
}

export function createProject(i: NewProjectInput): Project {
  const aspect = i.aspect ?? "9:16";
  const templateId = presetOf(i.templateId ?? "classic");
  const now = new Date().toISOString();
  const c = { ...i.theme, bg: i.theme.background };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: i.id,
    name: i.track.title || "Untitled story",
    createdAt: now,
    updatedAt: now,
    track: i.track,
    audio: { sourceAssetId: null, sourceDurationMs: null, snippetAssetId: null, snippet: null, ...i.audio },
    artwork: i.artwork,
    theme: { sync: true, ...i.theme },
    canvas: { aspect, fps: 30 },
    background: defaultBackground(templateId, c),
    effects: defaultEffects(templateId),
    templateId,
    templateVersion: TEMPLATE_VERSION,
    photo: null,
    elements: buildElements(templateId, aspect, c, i.track.title, { artist: i.track.artists.join(", ") }),
    progress: { mode: "snippet" },
    fallbackDurationMs: i.fallbackDurationMs ?? 15000,
  };
}

/**
 * The user choosing a template (also the one already selected): applies the current design of that template, so a project
 * saved with an older design moves to the refreshed one only through this call.
 */
export function applyTemplate(p: Project, templateId: string, aspect: AspectId = p.canvas.aspect): Project {
  const preset = presetOf(templateId);
  const next: Project = { ...p, templateId: preset, templateVersion: TEMPLATE_VERSION, typePair: undefined, canvas: { ...p.canvas, aspect } };
  return {
    ...next,
    background: defaultBackground(preset, colorsOf(p)),
    effects: defaultEffects(preset),
    elements: layoutOf(next, { aspect, pair: undefined }),
  };
}

/** Whether the project was saved with an older design of its template than the app now offers. */
export const hasNewerDesign = (p: Project) => templateVersionOf(p) < TEMPLATE_VERSION;

/** Re-layout for another canvas format. Keeps the project's design version (and chosen typography); element edits are reset. */
export function changeAspect(p: Project, aspect: AspectId): Project {
  const preset = presetOf(p.templateId);
  const v = templateVersionOf(p);
  const next: Project = { ...p, canvas: { ...p.canvas, aspect } };
  return { ...next, background: defaultBackground(preset, colorsOf(p), v), effects: defaultEffects(preset, v), elements: layoutOf(next) };
}

/** Reset one element to what the current template would generate. */
export function resetElement(p: Project, id: string): Project {
  const fresh = layoutOf(p);
  const cur = p.elements.find((e) => e.id === id);
  if (!cur) return p;
  const match = fresh.find((e) => e.id === id) ?? fresh.find((e) => e.type === cur.type && e.name === cur.name);
  return match ? { ...p, elements: p.elements.map((e) => (e.id === id ? { ...match, id } : e)) } : p;
}

// ---------- reflow ----------

const canon = (v: unknown): string =>
  JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const sameDesign = (a: StoryElement, b: StoryElement) => canon({ ...a, id: 0 }) === canon({ ...b, id: 0 });
const keyOf = (e: StoryElement) => `${e.type}|${e.name}`;

/**
 * Re-flows the layout after the text or the typography changed. Elements the user never touched (identical to what the
 * template generated before) move to the new layout; edited ones stay as they are, except that `fonts` also carries the
 * new typeface over to edited text.
 */
function reflow(p: Project, before: StoryElement[], after: StoryElement[], fonts: boolean): Project {
  const old = new Map(before.map((e) => [keyOf(e), e]));
  const fresh = new Map(after.map((e) => [keyOf(e), e]));
  let changed = false;
  const elements = p.elements.map((e) => {
    const o = old.get(keyOf(e)), f = fresh.get(keyOf(e));
    if (!o || !f) return e;
    if (sameDesign(e, o)) {
      if (sameDesign(o, f)) return e;
      changed = true;
      return { ...f, id: e.id };
    }
    if (fonts && e.text && f.text && (e.text.fontFamily !== f.text.fontFamily || e.text.fontWeight !== f.text.fontWeight)) {
      changed = true;
      return { ...e, text: { ...e.text, fontFamily: f.text.fontFamily, fontWeight: f.text.fontWeight, uppercase: f.text.uppercase } };
    }
    return e;
  });
  return changed ? { ...p, elements } : p;
}

/** After the title or artist changed (`prev` → `next`): refit the untouched title block. Designs before version 2 never reflow. */
export function reflowTrackText(prev: Project, next: Project): Project {
  if (templateVersionOf(next) < 2) return next;
  const same = prev.track.title === next.track.title && artistOf(prev) === artistOf(next);
  if (same) return next;
  return reflow(next, layoutOf(next, { track: prev.track }), layoutOf(next), false);
}

/** Switches the project's typography (or back to the template's own with undefined) and refits the text. */
export function setTypePair(p: Project, id: string | undefined): Project {
  if (templateVersionOf(p) < 2 || (id !== undefined && !typePairOf(id))) return p;
  const next: Project = { ...p, typePair: id };
  return reflow(next, layoutOf(p), layoutOf(next), true);
}

export type { TypePair };
