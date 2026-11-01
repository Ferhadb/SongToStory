import type { Anim } from "./schema";

export const NO_ANIM: Anim = { type: "none", startMs: 0, durationMs: 600, easing: "ease-out", intensity: 1 };

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function ease(kind: Anim["easing"], t: number): number {
  const x = clamp01(t);
  if (kind === "linear") return x;
  if (kind === "ease-out") return 1 - (1 - x) ** 3;
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

export interface AnimOut { opacity: number; translateY: number; scale: number; blur: number }
const IDENTITY: AnimOut = { opacity: 1, translateY: 0, scale: 1, blur: 0 };

/** `e` is eased visibility: 0 = fully hidden, 1 = settled. Pure function of (anim, e). */
function shape(a: Anim, e: number): AnimOut {
  const k = a.intensity;
  switch (a.type) {
    case "fade": return { ...IDENTITY, opacity: e };
    case "slide-up": return { ...IDENTITY, opacity: e, translateY: (1 - e) * 90 * k };
    case "slide-down": return { ...IDENTITY, opacity: e, translateY: -(1 - e) * 90 * k };
    case "scale": return { ...IDENTITY, opacity: e, scale: 1 - (1 - e) * 0.2 * k };
    case "blur": return { ...IDENTITY, opacity: e, blur: (1 - e) * 28 * k };
    default: return IDENTITY;
  }
}

/** Combined entrance + exit at `frame`. Exit `startMs` = how long before the story ends it finishes. */
export function animationAt(inA: Anim, outA: Anim, frame: number, fps: number, totalFrames: number): AnimOut {
  const f = (ms: number) => (ms / 1000) * fps;
  let r = IDENTITY;
  if (inA.type !== "none") {
    const p = inA.durationMs <= 0 ? (frame >= f(inA.startMs) ? 1 : 0) : (frame - f(inA.startMs)) / f(inA.durationMs);
    r = shape(inA, ease(inA.easing, p));
  }
  if (outA.type !== "none") {
    const endAt = totalFrames - f(outA.startMs);
    const p = outA.durationMs <= 0 ? (frame >= endAt ? 1 : 0) : (frame - (endAt - f(outA.durationMs))) / f(outA.durationMs);
    const o = shape(outA, 1 - ease(outA.easing, p));
    r = { opacity: r.opacity * o.opacity, translateY: r.translateY + o.translateY, scale: r.scale * o.scale, blur: r.blur + o.blur };
  }
  return r;
}

export function animCss(a: AnimOut): { opacity: number; transform: string; filter: string } {
  return {
    opacity: a.opacity,
    transform: `translateY(${a.translateY}px) scale(${a.scale})`,
    filter: a.blur > 0.05 ? `blur(${a.blur}px)` : "none",
  };
}
