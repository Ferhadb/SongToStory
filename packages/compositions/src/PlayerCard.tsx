import React from "react";
import { Img } from "remotion";
import { fam, PLAYER_FONT } from "./fonts";
import { textWidth } from "./measure";
import { PLAYER_RATIO } from "./photo";
import { formatClock, progressAt } from "./progress";
import type { PlayerSettings, Project, StoryElement } from "./schema";

/** The card is drawn on a 1000-wide grid and scaled to the element, so every proportion survives resizing. */
const GRID = 1000;

export interface PlayerCardProps {
  e: StoryElement; p: Project; frame: number; fps: number;
  /** Draws the track artwork (with the project's cover crop) as a square of the given side. */
  artwork: (size: number) => React.ReactNode;
  assetBase: string;
}

export const playerText = (pl: PlayerSettings, p: Pick<Project, "track">) => ({
  title: pl.title ?? p.track.title,
  artist: pl.artist ?? p.track.artists.join(", "),
});

export const PlayerCard: React.FC<PlayerCardProps> = ({ e, p, frame, fps, artwork, assetBase }) => {
  const pl = e.player;
  if (!pl) return null;
  const { title, artist } = playerText(pl, p);
  const pr = progressAt(p, frame);
  const art = (size: number) => pl.artwork
    ? <Img src={`${assetBase}/${pl.artwork.assetId}/stream`} style={{ width: size, height: size, objectFit: "cover", display: "block" }} />
    : artwork(size);
  const s = e.w / GRID;
  const H = GRID * PLAYER_RATIO[pl.style];
  const props: CardProps = { tone: pl.tone ?? "dark", title, artist, art, frac: Math.min(1, Math.max(0, pr.fraction)), elapsed: formatClock(pr.elapsedMs), remaining: formatClock(pr.remainingMs), total: formatClock(pr.totalMs), frame, fps };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: GRID, height: H, transform: `scale(${s})`, transformOrigin: "0 0" }}>
      {pl.style === "spotify" ? <SpotifyCard {...props} /> : pl.style === "apple-tall" ? <AppleTallCard {...props} /> : <AppleCard {...props} />}
    </div>
  );
};

interface CardProps {
  tone: "dark" | "light";
  title: string; artist: string; art: (size: number) => React.ReactNode; frac: number;
  elapsed: string; remaining: string; total: string; frame: number; fps: number;
}

/** One line of text that scrolls back and forth (like the real players) only when it does not fit. */
function Ticker({ text, width, font, size, weight, color, frame, fps, height }: {
  text: string; width: number; font: string; size: number; weight: number; color: string; frame: number; fps: number; height: number;
}) {
  const need = textWidth(text, font, size, { weight }) * 1.04;
  const over = need - width;
  const base: React.CSSProperties = { width, height, lineHeight: `${height}px`, fontFamily: fam(font), fontSize: size, fontWeight: weight, color, whiteSpace: "nowrap", overflow: "hidden" };
  if (over <= 0) return <div style={{ ...base, textOverflow: "ellipsis" }}>{text}</div>;
  const dist = over + size * 0.6, hold = 1.2, run = dist / (size * 2.6);
  const cycle = 2 * (hold + run), t = (frame / fps) % cycle;
  const k = t < hold ? 0 : t < hold + run ? (t - hold) / run : t < 2 * hold + run ? 1 : 1 - (t - 2 * hold - run) / run;
  const eased = k * k * (3 - 2 * k);
  // Soft edges while it travels, so the text slides under the card rather than being cut off; at rest the start stays crisp.
  const left = Math.round(Math.min(1, eased * 10) * size * 0.7), right = Math.round(Math.min(1, (1 - eased) * 10) * size * 0.7);
  const mask = `linear-gradient(90deg, transparent 0, #000 ${left}px, #000 ${width - right}px, transparent ${width}px)`;
  return (
    <div style={{ ...base, WebkitMaskImage: mask, maskImage: mask }}>
      <span style={{ display: "inline-block", transform: `translateX(${-eased * dist}px)` }}>{text}</span>
    </div>
  );
}

const frameOf = (art: CardProps["art"], size: number, radius: number, shadow?: string) => (
  <div style={{ width: size, height: size, borderRadius: radius, overflow: "hidden", background: "#2a2a2a", boxShadow: shadow, position: "relative" }}>{art(size)}</div>
);

// ---------- Apple Music style ----------

/** Colours of the Apple card: frosted dark glass, or frosted light glass with grey controls. */
const appleInk = (tone: "dark" | "light") => tone === "light"
  ? { glass: "rgba(246,246,248,0.88)", edge: "rgba(255,255,255,0.7)", shadow: "0 30px 80px rgba(0,0,0,0.18)", title: "#3b3b3f", sub: "rgba(60,60,67,0.5)", track: "rgba(60,60,67,0.2)", fill: "rgba(60,60,67,0.55)", icon: "#58585c", chip: "rgba(60,60,67,0.12)", time: "rgba(60,60,67,0.55)" }
  : { glass: "rgba(34,34,38,0.58)", edge: "rgba(255,255,255,0.16)", shadow: "0 30px 80px rgba(0,0,0,0.32)", title: "#fff", sub: "rgba(255,255,255,0.62)", track: "rgba(255,255,255,0.28)", fill: "#fff", icon: "#fff", chip: "rgba(255,255,255,0.2)", time: "rgba(255,255,255,0.55)" };

const AppleCard: React.FC<CardProps> = ({ tone, title, artist, art, frac, elapsed, remaining, frame, fps }) => {
  const f = PLAYER_FONT.apple, H = GRID * PLAYER_RATIO.apple, c = appleInk(tone);
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 64, background: c.glass, backdropFilter: "blur(54px) saturate(1.7)", border: `2px solid ${c.edge}`, boxShadow: c.shadow, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 44, top: 44 }}>{frameOf(art, 164, 30, "0 14px 36px rgba(0,0,0,0.35)")}</div>
      <div style={{ position: "absolute", left: 240, top: 68 }}>
        <Ticker text={title} width={640} font={f} size={46} weight={600} color={c.title} frame={frame} fps={fps} height={58} />
        <Ticker text={artist} width={640} font={f} size={40} weight={400} color={c.sub} frame={frame} fps={fps} height={52} />
      </div>
      <div style={{ position: "absolute", left: 900, top: 98, width: 56, height: 56, borderRadius: 28, background: c.chip }}>
        <svg width="56" height="56" viewBox="0 0 56 56" fill={c.icon}>{[16, 28, 40].map((x) => <circle key={x} cx={x} cy="28" r="3.6" />)}</svg>
      </div>
      <div style={{ position: "absolute", left: 44, top: 254, width: 912, height: 10, borderRadius: 5, background: c.track, overflow: "hidden" }}>
        <div style={{ width: `${frac * 100}%`, height: "100%", background: c.fill, borderRadius: 5 }} />
      </div>
      <div style={{ position: "absolute", left: 44, top: 278, width: 912, display: "flex", justifyContent: "space-between", fontFamily: fam(f), fontSize: 28, fontWeight: 500, color: c.time, fontVariantNumeric: "tabular-nums" }}>
        <span>{elapsed}</span><span>-{remaining}</span>
      </div>
      <svg style={{ position: "absolute", left: 0, top: 0 }} width={GRID} height={H} viewBox={`0 0 ${GRID} ${H}`} fill={c.icon}>
        <g transform="translate(274 338)"><polygon points="0,22 38,0 38,44" /><polygon points="34,22 72,0 72,44" /></g>
        <g transform="translate(466 336)"><rect x="0" y="0" width="15" height="48" rx="4" /><rect x="35" y="0" width="15" height="48" rx="4" /></g>
        <g transform="translate(654 338)"><polygon points="72,22 34,0 34,44" /><polygon points="38,22 0,0 0,44" /></g>
      </svg>
    </div>
  );
};

/** The large Apple card: full-width artwork, star, a volume row and an AirPlay chip (the card seen on the lock screen). */
const AppleTallCard: React.FC<CardProps> = ({ tone, title, artist, art, frac, elapsed, remaining, frame, fps }) => {
  const f = PLAYER_FONT["apple-tall"], H = GRID * PLAYER_RATIO["apple-tall"], c = appleInk(tone);
  const vol = 0.62;
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 84, background: c.glass, backdropFilter: "blur(54px) saturate(1.7)", border: `2px solid ${c.edge}`, boxShadow: c.shadow, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 56, top: 56 }}>{frameOf(art, 888, 40, "0 20px 50px rgba(0,0,0,0.35)")}</div>
      <div style={{ position: "absolute", left: 56, top: 988 }}>
        <Ticker text={title} width={780} font={f} size={54} weight={600} color={c.title} frame={frame} fps={fps} height={68} />
        <Ticker text={artist} width={780} font={f} size={48} weight={400} color={c.sub} frame={frame} fps={fps} height={62} />
      </div>
      <svg style={{ position: "absolute", left: 0, top: 0 }} width={GRID} height={H} viewBox={`0 0 ${GRID} ${H}`} fill="none" stroke={c.sub} strokeWidth="4" strokeLinejoin="round">
        <polygon transform="translate(886 1018)" points="24,2 30,17 46,18 34,29 38,45 24,36 10,45 14,29 2,18 18,17" />
      </svg>
      <div style={{ position: "absolute", left: 56, top: 1208, width: 888, height: 12, borderRadius: 6, background: c.track, overflow: "hidden" }}>
        <div style={{ width: `${frac * 100}%`, height: "100%", background: c.fill, borderRadius: 6 }} />
      </div>
      <div style={{ position: "absolute", left: 56, top: 1240, width: 888, display: "flex", justifyContent: "space-between", fontFamily: fam(f), fontSize: 32, fontWeight: 500, color: c.time, fontVariantNumeric: "tabular-nums" }}>
        <span>{elapsed}</span><span>-{remaining}</span>
      </div>
      <svg style={{ position: "absolute", left: 0, top: 0 }} width={GRID} height={H} viewBox={`0 0 ${GRID} ${H}`} fill={c.icon}>
        <g transform="translate(236 1334)"><polygon points="0,30 52,0 52,60" /><polygon points="48,30 100,0 100,60" /></g>
        <g transform="translate(466 1332)"><rect x="0" y="0" width="22" height="64" rx="5" /><rect x="46" y="0" width="22" height="64" rx="5" /></g>
        <g transform="translate(664 1334)"><polygon points="100,30 48,0 48,60" /><polygon points="52,30 0,0 0,60" /></g>
      </svg>
      <div style={{ position: "absolute", left: 56, top: 1496, width: 888, height: 12, borderRadius: 6, background: c.track, overflow: "hidden" }}>
        <div style={{ width: `${vol * 100}%`, height: "100%", background: c.fill, borderRadius: 6 }} />
      </div>
      <div style={{ position: "absolute", left: 360, top: 1572, width: 280, height: 84, borderRadius: 42, background: c.chip, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: fam(f), fontSize: 34, fontWeight: 600, color: c.title }}>
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke={c.icon} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="20" cy="17" r="4" fill={c.icon} /><path d="M11 25a13 13 0 1 1 18 0" /><path d="M15 21a7 7 0 1 1 10 0" /><polygon points="20,26 13,36 27,36" fill={c.icon} /></svg>
        AirPlay
      </div>
    </div>
  );
};

// ---------- Spotify style ----------

const GREEN = "#1ed760";

const SpotifyCard: React.FC<CardProps> = ({ title, artist, art, frac, elapsed, total, frame, fps }) => {
  const f = PLAYER_FONT.spotify, H = GRID * PLAYER_RATIO.spotify;
  const bar = 912, knob = 26;
  const stroke = { fill: "none", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 44, background: "linear-gradient(180deg, #2b2b2b 0%, #141414 62%)", border: "2px solid rgba(255,255,255,0.07)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 44, top: 44 }}>{frameOf(art, 150, 14, "0 10px 28px rgba(0,0,0,0.5)")}</div>
      <div style={{ position: "absolute", left: 214, top: 62 }}>
        <Ticker text={title} width={664} font={f} size={44} weight={700} color="#fff" frame={frame} fps={fps} height={56} />
        <Ticker text={artist} width={664} font={f} size={34} weight={500} color="#b3b3b3" frame={frame} fps={fps} height={46} />
      </div>
      <svg style={{ position: "absolute", left: 904, top: 90 }} width="52" height="52" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="26" fill={GREEN} />
        <polyline points="14,27 22,35 38,17" fill="none" stroke="#000" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ position: "absolute", left: 44, top: 242, width: bar, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.3)" }}>
        <div style={{ width: `${frac * 100}%`, height: "100%", background: "#fff", borderRadius: 4 }} />
        <div style={{ position: "absolute", left: frac * bar - knob / 2, top: 4 - knob / 2, width: knob, height: knob, borderRadius: knob / 2, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }} />
      </div>
      <div style={{ position: "absolute", left: 44, top: 272, width: bar, display: "flex", justifyContent: "space-between", fontFamily: fam(f), fontSize: 26, fontWeight: 500, color: "#a7a7a7", fontVariantNumeric: "tabular-nums" }}>
        <span>{elapsed}</span><span>{total}</span>
      </div>
      <svg style={{ position: "absolute", left: 0, top: 0 }} width={GRID} height={H} viewBox={`0 0 ${GRID} ${H}`}>
        <g transform="translate(76 360) scale(2)" stroke={GREEN} {...stroke}>
          <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" />
        </g>
        <g transform="translate(262 354)" fill="#fff"><rect x="0" y="0" width="8" height="56" rx="3" /><polygon points="60,0 16,28 60,56" /></g>
        <g transform="translate(446 326)"><circle cx="54" cy="54" r="54" fill="#fff" /><rect x="35" y="30" width="12" height="48" rx="3" fill="#000" /><rect x="61" y="30" width="12" height="48" rx="3" fill="#000" /></g>
        <g transform="translate(680 354)" fill="#fff"><polygon points="0,0 44,28 0,56" /><rect x="52" y="0" width="8" height="56" rx="3" /></g>
        <g transform="translate(878 360) scale(2)" stroke="#b3b3b3" {...stroke}>
          <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </g>
      </svg>
    </div>
  );
};
