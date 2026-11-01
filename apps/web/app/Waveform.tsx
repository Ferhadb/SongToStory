"use client";

import { useEffect, useRef } from "react";

export default function Waveform({
  peaks,
  progress,
  onSeek,
}: {
  peaks: number[];
  progress: number; // 0..1
  onSeek: (fraction: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(canvas);
    const played = css.getPropertyValue("--accent").trim() || "#c2410c";
    const rest = css.getPropertyValue("--muted").trim() || "#888";
    const barW = width / peaks.length;
    peaks.forEach((p, i) => {
      const h = Math.max(1.5, p * height * 0.9);
      ctx.fillStyle = i / peaks.length <= progress ? played : rest;
      ctx.fillRect(i * barW, (height - h) / 2, Math.max(1, barW - 1), h);
    });
  }, [peaks, progress]);

  return (
    <canvas
      ref={ref}
      role="slider"
      aria-label="Audio position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
      className="h-20 w-full cursor-pointer"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek((e.clientX - r.left) / r.width);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.02));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.02));
      }}
    />
  );
}
