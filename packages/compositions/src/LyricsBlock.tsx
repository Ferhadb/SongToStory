import React, { useMemo } from "react";
import { ease } from "./animations";
import { fam } from "./fonts";
import { activeAt, fitLyrics, lineTop, slotOf, slotOpacity } from "./lyrics";
import type { Project, StoryElement } from "./schema";
import { typePairOf } from "./typography";

/** Spotify-style lyrics inside the "lyrics" element: previous and next lines dimmed, the active one lit, the stack gliding on each change. */
export const LyricsBlock: React.FC<{ e: StoryElement; p: Project; frame: number; fps: number }> = ({ e, p, frame, fps }) => {
  const ly = p.lyrics;
  const lines = ly?.lines ?? [];
  const f = typePairOf(p.typePair)?.heading ?? { font: "Manrope", weight: 800, track: -0.02 };
  const upper = "upper" in f ? !!f.upper : false;
  const fit = useMemo(
    () => fitLyrics(lines.map((l) => l.text), f.font, { weight: f.weight, upper, tracking: f.track }, e.w, e.h, (ly?.size ?? 0.09) * (p.canvas.aspect === "16:9" ? 1920 : 1080)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, f.font, f.weight, e.w, e.h, ly?.size, p.canvas.aspect],
  );
  if (!ly || !lines.length) return null;

  const { idx, t } = activeAt(lines, (frame / fps) * 1000);
  const k = ease("ease-out", t);
  const a = Math.max(idx, 0), prev = Math.max(idx - 1, 0), cy = e.h / 2;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {lines.map((l, i) => {
        const slot = slotOf(i, idx, k);
        const op = slotOpacity(slot);
        if (op <= 0 || !l.text.trim()) return null;
        const top = lineTop(i, prev, cy, fit) * (1 - k) + lineTop(i, a, cy, fit) * k;
        const lit = Math.max(0, 1 - Math.abs(slot));
        return (
          <div key={i} style={{
            position: "absolute", left: 0, width: e.w, top, textAlign: ly.align, fontFamily: fam(f.font), fontWeight: f.weight, fontSize: fit.size,
            lineHeight: 1.15, letterSpacing: `${f.track ?? 0}em`, textTransform: upper ? "uppercase" : undefined, textWrap: "balance" as never, opacity: op,
            color: ly.highlight === "accent" && lit > 0.5 ? p.theme.accent : p.theme.text,
            transform: `scale(${0.9 + 0.1 * lit})`, transformOrigin: ly.align === "left" ? "left center" : "center",
          }}>{l.text}</div>
        );
      })}
    </div>
  );
};
