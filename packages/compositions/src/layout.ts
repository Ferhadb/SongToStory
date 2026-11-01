export interface Rect { x: number; y: number; w: number; h: number }
export interface Guide { axis: "x" | "y"; pos: number }

/** Snap a moving rect to canvas edges/center and other elements. Returns the adjusted rect + guides. */
export function snapMove(r: Rect, others: Rect[], canvas: { w: number; h: number }, threshold: number): { rect: Rect; guides: Guide[] } {
  const xs = [0, canvas.w / 2, canvas.w, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const ys = [0, canvas.h / 2, canvas.h, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  const best = (points: number[], targets: number[]) => {
    let bestD = Infinity, delta = 0, at = 0;
    for (const p of points) for (const t of targets) {
      const d = t - p;
      if (Math.abs(d) < Math.abs(bestD)) { bestD = d; delta = d; at = t; }
    }
    return Math.abs(bestD) <= threshold ? { delta, at } : null;
  };
  const sx = best([r.x, r.x + r.w / 2, r.x + r.w], xs);
  const sy = best([r.y, r.y + r.h / 2, r.y + r.h], ys);
  return {
    rect: { ...r, x: r.x + (sx?.delta ?? 0), y: r.y + (sy?.delta ?? 0) },
    guides: [...(sx ? [{ axis: "x" as const, pos: sx.at }] : []), ...(sy ? [{ axis: "y" as const, pos: sy.at }] : [])],
  };
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Resize from a handle. `lockAspect` keeps ratio (corner handles only). Enforces a minimum size. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, lockAspect: boolean, min = 20): Rect {
  let { x, y, w, h } = start;
  const west = handle.includes("w"), east = handle.includes("e"), north = handle.includes("n"), south = handle.includes("s");
  if (east) w = start.w + dx;
  if (west) { w = start.w - dx; }
  if (south) h = start.h + dy;
  if (north) { h = start.h - dy; }
  if (lockAspect) {
    const ratio = start.w / start.h;
    if (handle.length === 2) {
      // corner: derive the dominant axis
      if (Math.abs(w - start.w) / start.w >= Math.abs(h - start.h) / start.h) h = w / ratio;
      else w = h * ratio;
    } else if (east || west) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  if (lockAspect) {
    const ratio = start.w / start.h;
    if (w / h > ratio) w = h * ratio; else h = w / ratio;
  }
  if (west) x = start.x + start.w - w;
  if (north) y = start.y + start.h - h;
  return { x, y, w, h };
}
