"use client";

import { useEffect, useRef, useState } from "react";
import { drawCover, type CoverParams } from "@/lib/artwork";

export default function CoverCanvas({
  src, params, size = 240, onLoad, onPan,
}: {
  src: string;
  params: CoverParams;
  size?: number;
  onLoad?: (img: HTMLImageElement) => void;
  onPan?: (dx: number, dy: number) => void; // normalized -1..1 deltas
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let live = true;
    const el = new Image();
    el.onload = () => { if (live) { setImg(el); setFailed(false); onLoad?.(el); } };
    el.onerror = () => { if (live) setFailed(true); };
    el.src = src;
    return () => { live = false; };
    // onLoad intentionally not a dependency: callers pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !img) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = Math.round(size * dpr);
    drawCover(c.getContext("2d")!, img, params, c.width);
  }, [img, params, size]);

  if (failed) {
    return <div style={{ width: size, height: size }} className="flex items-center justify-center border border-line text-xs text-muted">Image unavailable</div>;
  }
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size, touchAction: "none" }}
      className={onPan ? "cursor-move" : undefined}
      aria-label="Cover preview"
      role="img"
      onPointerDown={(e) => { if (onPan) { e.currentTarget.setPointerCapture(e.pointerId); last.current = { x: e.clientX, y: e.clientY }; } }}
      onPointerMove={(e) => {
        if (!last.current || !onPan) return;
        onPan(-(e.clientX - last.current.x) / (size / 2), -(e.clientY - last.current.y) / (size / 2));
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => { last.current = null; }}
    />
  );
}
