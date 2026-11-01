import React from "react";
import { levelsAt, type Analysis } from "./analysis";
import type { StoryElement } from "./schema";

type Vis = NonNullable<StoryElement["vis"]>;

export const DEFAULT_VIS: Vis = { style: "bars", bars: 32, color: "#ffffff", gap: 0.35, rounded: true, sensitivity: 1.1, smoothing: 0.5 };

/** Audio-reactive spectrum drawn as SVG; a pure function of (analysis, frame, props). */
export const VisualizerView: React.FC<{ vis: Vis; w: number; h: number; analysis: Analysis | null; frame: number }> = ({ vis, w, h, analysis, frame }) => {
  const n = vis.bars;
  const lv = levelsAt(analysis, frame, n, vis.smoothing).map((v) => Math.min(1, v * vis.sensitivity));
  const MIN = 0.03; // keep a hairline so silence doesn't look broken
  const fill = vis.color;

  if (vis.style === "line") {
    const pts = lv.map((v, i) => `${(i / (n - 1)) * w},${h - (MIN + v * (1 - MIN)) * h}`).join(" ");
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline points={pts} fill="none" stroke={fill} strokeWidth={Math.max(3, h * 0.025)} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }

  if (vis.style === "radial") {
    const size = Math.min(w, h), cx = w / 2, cy = h / 2;
    const r0 = size * 0.24, maxLen = size * 0.26;
    const bw = Math.max(2, ((2 * Math.PI * r0) / n) * (1 - vis.gap));
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {lv.map((v, i) => {
          const a = (i / n) * 360 - 90;
          const len = (MIN + v) * maxLen;
          return <rect key={i} x={cx - bw / 2} y={cy - r0 - len} width={bw} height={len} rx={vis.rounded ? bw / 2 : 0} fill={fill} transform={`rotate(${a + 90} ${cx} ${cy})`} />;
        })}
      </svg>
    );
  }

  const slot = w / n, bw = slot * (1 - vis.gap);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {lv.map((v, i) => {
        const x = i * slot + (slot - bw) / 2;
        const bh = (MIN + v * (1 - MIN)) * (vis.style === "mirror" ? h / 2 : h);
        const y = vis.style === "mirror" ? h / 2 - bh : h - bh;
        const height = vis.style === "mirror" ? bh * 2 : bh;
        return <rect key={i} x={x} y={y} width={bw} height={height} rx={vis.rounded ? Math.min(bw / 2, height / 2) : 0} fill={fill} />;
      })}
    </svg>
  );
};
