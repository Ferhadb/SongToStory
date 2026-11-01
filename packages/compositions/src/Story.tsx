import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Audio, Img, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import { animCss, animationAt } from "./animations";
import { coverFilter, coverTransform, grainTile } from "./artwork";
import { formatClock, progressAt } from "./progress";
import { bassAt, decodeAnalysis, type Analysis, type AnalysisPayload } from "./analysis";
import { VisualizerView } from "./Visualizer";
import { FONT_LOADERS, fam, PLAYER_FONT } from "./fonts";
import { fitText } from "./measure";
import { photoRect } from "./photo";
import { PlayerCard } from "./PlayerCard";
import { ASPECTS, type Background, type Photo, type Project, type StoryElement } from "./schema";

export interface StoryProps {
  project: Project; assetBase: string;
  /** Pre-baked analysis (export). When absent the preview fetches it from the API. */
  analysis?: AnalysisPayload | null;
  /** Gallery thumbnails: skip fetching the audio analysis (spectrum shows flat). */
  staticPreview?: boolean;
}

function useFonts(families: string[]) {
  const key = families.join("|");
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    let live = true;
    Promise.all(families.map((f) => FONT_LOADERS[f]?.() ?? Promise.resolve()))
      .then(() => document.fonts.ready)
      .catch(() => undefined)
      .finally(() => live && continueRender(handle));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

const usesAnalysis = (p: Project) =>
  !!p.audio.snippetAssetId && p.elements.some((e) => e.visible && (e.type === "visualizer" || (e.reactive ?? 0) > 0));

function useAnalysis(project: Project, assetBase: string, injected: AnalysisPayload | null | undefined, skip?: boolean): Analysis | null {
  const need = !skip && usesAnalysis(project);
  const id = project.audio.snippetAssetId;
  const fps = project.canvas.fps;
  const [fetched, setFetched] = useState<{ key: string; a: Analysis } | null>(null);
  const [handle] = useState(() => (need && !injected ? delayRender("analysis") : null));
  const key = `${id}:${fps}`;
  const baked = useMemo(() => (injected ? decodeAnalysis(injected) : null), [injected]);
  useEffect(() => {
    if (!need || injected || !id) return;
    let live = true;
    fetch(`${assetBase}/${id}/analysis?fps=${fps}&bands=64`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: AnalysisPayload) => { if (live) setFetched({ key, a: decodeAnalysis(p) }); })
      .catch(() => undefined) // preview degrades to flat bars; export always injects
      .finally(() => { if (handle !== null) continueRender(handle); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need, injected, id, fps, assetBase, key]);
  if (!need) return null;
  return baked ?? (fetched && fetched.key === key ? fetched.a : null);
}

export const Story: React.FC<StoryProps> = ({ project, assetBase, analysis: injected, staticPreview }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { w, h } = ASPECTS[project.canvas.aspect];
  useFonts(Array.from(new Set([
    ...project.elements.map((e) => e.text?.fontFamily).filter(Boolean) as string[],
    ...(project.elements.some((e) => e.visible && e.coverStyle === "polaroid") ? ["Playfair Display", "JetBrains Mono"] : []), // the original card draws its own caption
    ...project.elements.filter((e) => e.visible && e.coverStyle === "print").flatMap((e) => [e.text?.fontFamily ?? "Manrope", "Inter"]),
    ...project.elements.filter((e) => e.visible && e.type === "player" && e.player).map((e) => PLAYER_FONT[e.player!.style]),
  ])));
  const analysis = useAnalysis(project, assetBase, injected, staticPreview);
  const art = project.artwork ? `${assetBase}/${project.artwork.assetId}/stream` : null;
  const snippetUrl = project.audio.snippetAssetId ? `${assetBase}/${project.audio.snippetAssetId}/stream` : null;

  return (
    <AbsoluteFill style={{ width: w, height: h, overflow: "hidden", background: "#000" }}>
      <BackgroundLayer bg={project.background} art={art} photo={project.photo ?? null} assetBase={assetBase} frame={frame} fps={fps} total={durationInFrames} w={w} h={h} />
      {project.effects.vignette > 0 && (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${project.effects.vignette / 100}) 100%)` }} />
      )}
      {project.elements.filter((e) => e.visible).map((e) => (
        <ElementView key={e.id} e={e} p={project} art={art} assetBase={assetBase} frame={frame} fps={fps} total={durationInFrames} analysis={analysis} />
      ))}
      {project.effects.grain > 0 && <GrainLayer amount={project.effects.grain / 100} />}
      {snippetUrl && <Audio src={snippetUrl} />}
    </AbsoluteFill>
  );
};

function GrainLayer({ amount }: { amount: number }) {
  const tile = useMemo(() => grainTile(), []);
  return <AbsoluteFill style={{ backgroundImage: `url(${tile})`, opacity: amount * 0.5, mixBlendMode: "overlay" }} />;
}

function BackgroundLayer({ bg, art, photo, assetBase, frame, fps, total, w, h }: { bg: Background; art: string | null; photo: Photo | null; assetBase: string; frame: number; fps: number; total: number; w: number; h: number }) {
  if (bg.type === "photo") return <PhotoLayer photo={photo} assetBase={assetBase} w={w} h={h} />;
  if (bg.type === "aurora") return <Aurora bg={bg} t={(frame / fps) * bg.speed} w={w} h={h} />;
  if (bg.type === "solid") return <AbsoluteFill style={{ background: bg.color }} />;
  if (bg.type === "gradient") {
    const angle = bg.angle + bg.motion * (frame / fps);
    return <AbsoluteFill style={{ background: `linear-gradient(${angle}deg, ${bg.from}, ${bg.to})` }} />;
  }
  return (
    <AbsoluteFill style={{ background: bg.overlay }}>
      {art && (
        <Img
          src={art}
          style={{
            position: "absolute", left: "50%", top: "50%", width: Math.max(w, h), height: Math.max(w, h), objectFit: "cover",
            transform: `translate(${-50 + (bg.drift ?? 0) * -3 * (frame / Math.max(1, total))}%, -50%) scale(${bg.zoom * (1 + (bg.drift ?? 0) * 0.14 * (frame / Math.max(1, total)))})`,
            filter: `blur(${bg.blur}px) brightness(${bg.brightness}%) saturate(${bg.saturation}%)`,
          }}
        />
      )}
      <AbsoluteFill style={{ background: bg.overlay, opacity: bg.overlayOpacity }} />
    </AbsoluteFill>
  );
}

function PhotoNotice({ message }: { message: string }) {
  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #3b352d 0%, #15130f 100%)", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: "70%", textAlign: "center", color: "rgba(255,255,255,0.7)", fontFamily: fam("Inter"), fontSize: 44, fontWeight: 600, lineHeight: 1.3 }}>{message}</div>
    </AbsoluteFill>
  );
}

/** The user's photo, cropped by its zoom/focus, dimmed, with a soft shade at the foot so the player card stays legible. */
function PhotoLayer({ photo, assetBase, w, h }: { photo: Photo | null; assetBase: string; w: number; h: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!photo || !photo.assetId) return <PhotoNotice message="Add a photo to start your story" />;
  const src = `${assetBase}/${photo.assetId}/stream`;
  if (failed === src) return <PhotoNotice message="This photo couldn’t be loaded. Upload it again." />;
  const r = photoRect(photo, w, h);
  return (
    <AbsoluteFill style={{ background: "#0b0b0b", overflow: "hidden" }}>
      <Img src={src} onError={() => setFailed(src)} style={{ position: "absolute", left: r.left, top: r.top, width: r.width, height: r.height, maxWidth: "none" }} />
      <AbsoluteFill style={{ background: `rgba(0,0,0,${photo.dim})` }} />
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 46%)" }} />
    </AbsoluteFill>
  );
}

/** Three soft colour blobs drifting on slow sine paths over a dark base. Pure function of time. */
function Aurora({ bg, t, w, h }: { bg: Extract<Background, { type: "aurora" }>; t: number; w: number; h: number }) {
  const big = Math.max(w, h);
  return (
    <AbsoluteFill style={{ background: bg.base, overflow: "hidden" }}>
      {bg.colors.map((c, i) => {
        const d = big * (0.95 + 0.12 * Math.sin(t * 0.25 + i * 1.3));
        const cx = w * (0.5 + 0.38 * Math.sin(t * 0.33 + i * 2.1)), cy = h * (0.5 + 0.36 * Math.cos(t * 0.27 + i * 1.7));
        return (
          <div key={i} style={{ position: "absolute", left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: "50%",
            background: `radial-gradient(circle at center, ${c} 0%, ${c}00 66%)`, opacity: 0.78, mixBlendMode: "screen" }} />
        );
      })}
    </AbsoluteFill>
  );
}

function idleCss(idle: StoryElement["idle"], t: number): { move: string; rot: number } {
  switch (idle) {
    case "float": return { move: `translateY(${Math.sin(t * 1.25) * 14}px)`, rot: 0 };
    case "breathe": return { move: `scale(${1 + 0.03 * Math.sin(t * 1.5)})`, rot: 0 };
    case "sway": return { move: "", rot: Math.sin(t * 1.0) * 1.8 };
    case "spin": return { move: "", rot: t * 14 };
    default: return { move: "", rot: 0 };
  }
}

function ElementView({ e, p, art, assetBase, frame, fps, total, analysis }: { e: StoryElement; p: Project; art: string | null; assetBase: string; frame: number; fps: number; total: number; analysis: Analysis | null }) {
  const a = animCss(animationAt(e.in, e.out, frame, fps, total));
  const pulse = (e.reactive ?? 0) > 0 ? 1 + (e.reactive ?? 0) * 0.08 * bassAt(analysis, frame) : 1;
  const idle = idleCss(e.idle, frame / fps);
  return (
    <div
      style={{
        position: "absolute", left: e.x, top: e.y, width: e.w, height: e.h,
        opacity: e.opacity * a.opacity, transform: `rotate(${e.rotation + idle.rot}deg) ${a.transform} ${idle.move} scale(${pulse})`, filter: a.filter,
        transformOrigin: "center",
      }}
    >
      <ElementBody e={e} p={p} art={art} assetBase={assetBase} frame={frame} fps={fps} analysis={analysis} />
    </div>
  );
}

function textOf(e: StoryElement, p: Project): string {
  switch (e.type) {
    case "title": return p.track.title;
    case "artist": return p.track.artists.join(", ");
    case "album": return p.track.album ?? "";
    case "source": return p.track.platform;
    default: return (e.content ?? "").replace(/\{(title|artist|album)\}/g, (_, k: string) => (k === "title" ? p.track.title : k === "artist" ? p.track.artists.join(", ") : p.track.album ?? ""));
  }
}

function ElementBody({ e, p, art, assetBase, frame, fps, analysis }: { e: StoryElement; p: Project; art: string | null; assetBase: string; frame: number; fps: number; analysis: Analysis | null }) {
  if (e.type === "visualizer" && e.vis) return <VisualizerView vis={e.vis} w={e.w} h={e.h} analysis={analysis} frame={frame} />;
  if (e.type === "shape") return <ShapeView e={e} />;
  if (e.type === "player") {
    const trackArt = (size: number) => (p.artwork && art ? <ArtSquare p={p} art={art} size={size} radiusPct={0} /> : null);
    return <PlayerCard e={e} p={p} frame={frame} fps={fps} artwork={trackArt} assetBase={assetBase} />;
  }
  if (e.type === "cover") return <CoverView e={e} p={p} art={art} frame={frame} fps={fps} />;
  if (e.type === "panel" && e.panel) {
    const pn = e.panel;
    return <div style={{ position: "absolute", inset: 0, borderRadius: pn.radius, background: pn.fill, opacity: pn.fillOpacity, backdropFilter: `blur(${pn.blur}px)`, border: `2px solid rgba(255,255,255,${pn.borderOpacity})` }} />;
  }
  if (e.type === "panel") {
    return <div style={{ position: "absolute", inset: 0, borderRadius: 48, background: "rgba(255,255,255,0.12)", backdropFilter: "blur(40px)", border: "2px solid rgba(255,255,255,0.18)" }} />;
  }
  if (e.type === "progress") {
    const b = e.bar ?? { color: "#fff", trackColor: "#fff", trackOpacity: 0.3, rounded: true };
    const f = progressAt(p, frame).fraction;
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <div style={{ position: "absolute", inset: 0, background: b.trackColor, opacity: b.trackOpacity, borderRadius: b.rounded ? 999 : 0 }} />
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${f * 100}%`, background: b.color, borderRadius: b.rounded ? 999 : 0 }} />
      </div>
    );
  }
  if (e.type === "controls") return <Controls color={e.ctl?.color ?? "#fff"} />;
  if (e.type === "time" && e.text) {
    const pr = progressAt(p, frame);
    const ms = e.timeKind === "remaining" ? pr.remainingMs : e.timeKind === "total" ? pr.totalMs : pr.elapsedMs;
    const label = (e.timeKind === "remaining" ? "-" : "") + formatClock(ms);
    return <TextBox e={e} s={label} frame={frame} fps={fps} />;
  }
  if (e.text) return <TextBox e={e} s={textOf(e, p)} frame={frame} fps={fps} />;
  return null;
}

function TextBox({ e, s, frame, fps }: { e: StoryElement; s: string; frame: number; fps: number }) {
  const t = e.text!;
  const base: React.CSSProperties = {
    color: t.outline ? "transparent" : t.color, textAlign: t.align,
    WebkitTextStroke: t.outline ? `${Math.max(2, t.fontSize * 0.022)}px ${t.color}` : undefined,
    fontFamily: fam(t.fontFamily), fontSize: t.fontSize, fontWeight: t.fontWeight, letterSpacing: t.letterSpacing,
    lineHeight: t.lineHeight, textTransform: t.uppercase ? "uppercase" : "none",
    textShadow: t.shadow ? "0 4px 24px rgba(0,0,0,0.45)" : "none", fontVariantNumeric: "tabular-nums",
  };
  if (t.scroll) {
    // Two identical copies, shifted by a fraction of the row's own width, so the loop seam is exact whatever the font.
    const unit = Math.max(1, s.length + 5) * t.fontSize * 0.6; // estimate, only used for speed + how many repeats fill the box
    const reps = Math.ceil(e.w / unit) + 1;
    const phase = (((frame / fps) * Math.abs(t.scroll)) / (unit * reps)) % 1;
    const copy = Array.from({ length: reps }, () => `${s}   ✦   `).join("");
    return (
      <div style={{ width: "100%", height: "100%", overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div style={{ ...base, display: "flex", whiteSpace: "nowrap", flex: "none",
          transform: `translateX(${t.scroll < 0 ? -50 + phase * 50 : -phase * 50}%)` }}>
          <span>{copy}</span><span>{copy}</span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: t.valign === "bottom" ? "flex-end" : t.valign === "middle" ? "center" : "flex-start" }}>
      <div style={{ ...base, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: t.maxLines, overflowWrap: "anywhere", textWrap: t.balance ? "balance" : undefined }}>{s}</div>
    </div>
  );
}

function ShapeView({ e }: { e: StoryElement }) {
  const sh = e.shape ?? { kind: "rect" as const, color: "#ffffff", thickness: 4, radius: 0 };
  const fill: React.CSSProperties =
    sh.kind === "glow" ? { background: `radial-gradient(circle at center, ${sh.color} 0%, ${sh.color}00 68%)`, borderRadius: "50%" }
    : sh.kind === "ring" ? { border: `${sh.thickness}px solid ${sh.color}`, borderRadius: "50%", boxSizing: "border-box" }
    : sh.kind === "ellipse" ? { background: sh.color, borderRadius: "50%" }
    : { background: sh.color, borderRadius: sh.radius };
  return <div style={{ position: "absolute", inset: 0, ...fill }} />;
}

function Controls({ color }: { color: string }) {
  const c = { fill: color };
  return (
    <svg viewBox="0 0 380 96" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <polygon points="40,48 76,24 76,72" {...c} /><rect x="30" y="24" width="8" height="48" rx="2" {...c} />
      <circle cx="190" cy="48" r="44" {...c} /><polygon points="176,28 176,68 208,48" fill="#000" opacity="0.85" />
      <polygon points="340,48 304,24 304,72" {...c} /><rect x="342" y="24" width="8" height="48" rx="2" {...c} />
    </svg>
  );
}

const GROOVES = "repeating-radial-gradient(circle at center, rgba(255,255,255,0) 0px, rgba(255,255,255,0) 3px, rgba(255,255,255,0.07) 3px, rgba(255,255,255,0.07) 4px)";
const SHEEN = "conic-gradient(from 25deg at 50% 50%, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.20) 28deg, rgba(255,255,255,0) 60deg, rgba(255,255,255,0) 180deg, rgba(255,255,255,0.14) 208deg, rgba(255,255,255,0) 240deg)";

/** The cropped, adjusted artwork filling a square of side `size` (parent supplies rounding/clipping). */
function ArtSquare({ p, art, size, radiusPct }: { p: Project; art: string; size: number; radiusPct?: number }) {
  const aw = p.artwork!;
  const cp = aw.params;
  const tr = coverTransform(cp, aw.width, aw.height, size);
  return (
    <div style={{ position: "relative", width: size, height: size, overflow: "hidden", borderRadius: ((radiusPct ?? cp.radius) / 100) * size }}>
      <Img src={art} style={{ position: "absolute", left: tr.left, top: tr.top, width: tr.width, height: tr.height, maxWidth: "none", transform: `rotate(${cp.rotation}deg)`, filter: coverFilter(cp, size) }} />
      {cp.grain > 0 && <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${grainTile()})`, opacity: (cp.grain / 100) * 0.3 }} />}
    </div>
  );
}

function Hole({ size }: { size: number }) {
  return <div style={{ position: "absolute", left: "50%", top: "50%", width: size, height: size, transform: "translate(-50%, -50%)", borderRadius: "50%", background: "#0b0b0b", boxShadow: "0 0 0 3px rgba(255,255,255,0.18), inset 0 0 6px rgba(0,0,0,0.8)" }} />;
}

function CoverView({ e, p, art, frame, fps }: { e: StoryElement; p: Project; art: string | null; frame: number; fps: number }) {
  const aw = p.artwork;
  if (!aw || !art) return <div style={{ width: "100%", height: "100%", background: "#222", borderRadius: 24 }} />;
  const cp = aw.params;
  const size = e.w;
  const shadow = e.shadow ?? 0;
  const drop = shadow ? `0 ${shadow * 0.5}px ${shadow}px rgba(0,0,0,0.45)` : "none";
  const spin = (frame / fps) * 30; // degrees, ~5 rpm: reads as a record without strobing
  const style = e.coverStyle ?? "plain";

  if (style === "disc") {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden", boxShadow: drop }}>
        <div style={{ position: "absolute", inset: 0, transform: `rotate(${spin}deg)` }}><ArtSquare p={p} art={art} size={size} radiusPct={50} /></div>
        <div style={{ position: "absolute", inset: 0, background: GROOVES, borderRadius: "50%" }} />
        <div style={{ position: "absolute", inset: 0, background: SHEEN, borderRadius: "50%" }} />
        <Hole size={size * 0.07} />
      </div>
    );
  }

  if (style === "vinyl") {
    // The element is the sleeve; the record slides out of its right edge (and sticks out by ~30%).
    const D = size * 0.94, label = D * 0.38;
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <div style={{ position: "absolute", left: size * 0.36, top: (size - D) / 2, width: D, height: D, borderRadius: "50%", background: "#0c0c0c", boxShadow: "0 18px 50px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.16)", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, transform: `rotate(${spin}deg)` }}>
            <div style={{ position: "absolute", inset: 0, background: GROOVES }} />
            <div style={{ position: "absolute", left: (D - label) / 2, top: (D - label) / 2, width: label, height: label, borderRadius: "50%", overflow: "hidden" }}>
              <ArtSquare p={p} art={art} size={label} radiusPct={50} />
            </div>
          </div>
          <div style={{ position: "absolute", inset: 0, background: SHEEN }} />
          <Hole size={D * 0.035} />
        </div>
        <div style={{ position: "absolute", inset: 0, boxShadow: drop, borderRadius: (cp.radius / 100) * size }}>
          <ArtSquare p={p} art={art} size={size} />
        </div>
      </div>
    );
  }

  if (style === "polaroid") {
    const pad = e.w * 0.065, img = e.w - pad * 2, strip = e.h - pad - img;
    const title = p.track.title, artist = p.track.artists.join(", ");
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", background: "#f6f2e8", borderRadius: 6, boxShadow: drop }}>
        <div style={{ position: "absolute", left: pad, top: pad, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }}><ArtSquare p={p} art={art} size={img} radiusPct={0} /></div>
        <div style={{ position: "absolute", left: pad, right: pad, top: pad + img, height: strip, display: "flex", flexDirection: "column", justifyContent: "center", gap: strip * 0.06, color: "#1b1b1b", textAlign: "center" }}>
          <div style={{ fontFamily: fam("Playfair Display"), fontWeight: 700, fontSize: strip * 0.3, lineHeight: 1.1, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 1 }}>{title}</div>
          {artist && <div style={{ fontFamily: fam("JetBrains Mono"), fontWeight: 500, fontSize: strip * 0.15, letterSpacing: strip * 0.012, textTransform: "uppercase", opacity: 0.6, overflow: "hidden", whiteSpace: "nowrap" }}>{artist}</div>}
        </div>
      </div>
    );
  }

  if (style === "print") return <PrintCard e={e} p={p} art={art} drop={drop} />;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: (cp.radius / 100) * size, boxShadow: drop }}>
      <ArtSquare p={p} art={art} size={size} />
    </div>
  );
}

/** A clean instant print: paper card, the artwork as the photo, the song written underneath. */
function PrintCard({ e, p, art, drop }: { e: StoryElement; p: Project; art: string; drop: string }) {
  const pad = e.w * 0.06, img = e.w - pad * 2;
  const capTop = pad + img, capH = e.h - capTop - pad * 0.6;
  const font = e.text?.fontFamily ?? "Manrope", weight = e.text?.fontWeight ?? 800, upper = !!e.text?.uppercase;
  const title = p.track.title, artist = p.track.artists.join(", ");
  const artistSize = Math.round(capH * 0.14);
  const tf = fitText(title || " ", { font, weight, upper, maxW: img, maxLines: 2, maxSize: capH * 0.34, minSize: capH * 0.16, tracking: -0.01, maxH: capH - (artist ? artistSize * 1.9 : 0), lineHeight: 1.12 });
  const af = fitText(artist || " ", { font: "Inter", weight: 600, upper: true, maxW: img, maxLines: 1, maxSize: artistSize, minSize: artistSize * 0.6, tracking: 0.12 });
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 6, background: "linear-gradient(180deg, #fbf9f3 0%, #f1ede2 100%)", boxShadow: drop }}>
      <div style={{ position: "absolute", left: pad, top: pad, boxShadow: "0 0 0 1px rgba(0,0,0,0.1), inset 0 0 24px rgba(0,0,0,0.12)" }}>
        <ArtSquare p={p} art={art} size={img} radiusPct={0} />
        <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12), inset 0 0 36px rgba(0,0,0,0.14)" }} />
      </div>
      <div style={{ position: "absolute", left: pad, top: capTop, width: img, height: capH, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: capH * 0.05, color: "#1c1b19" }}>
        <div style={{ width: "100%", fontFamily: fam(font), fontWeight: weight, fontSize: tf.size, lineHeight: 1.12, letterSpacing: -0.01 * tf.size, textTransform: upper ? "uppercase" : "none", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: tf.lines, overflowWrap: "anywhere", textWrap: "balance" }}>{title}</div>
        {artist && <div style={{ width: "100%", fontFamily: fam("Inter"), fontWeight: 600, fontSize: af.size, letterSpacing: 0.12 * af.size, textTransform: "uppercase", opacity: 0.58, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{artist}</div>}
      </div>
    </div>
  );
}
