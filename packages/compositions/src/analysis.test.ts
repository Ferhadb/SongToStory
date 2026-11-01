import { describe, expect, it } from "vitest";
import { bassAt, decodeAnalysis, levelsAt, rmsAt, type Analysis } from "./analysis";
import { buildElements, TEMPLATES } from "./templates";
import { ProjectSchema } from "./schema";

// 4 frames × (8 bands + rms). Frame 1 has a loud band 0 (bass) and nothing else.
function fake(): Analysis {
  const bands = 8, frames = 4, data = new Uint8Array(frames * (bands + 1));
  data[1 * 9 + 0] = 255;
  data[1 * 9 + 8] = 200;
  return { fps: 30, bands, frames, data };
}

describe("analysis", () => {
  it("decodes the base64 payload", () => {
    const raw = new Uint8Array([0, 128, 255]);
    const a = decodeAnalysis({ fps: 30, bands: 2, frames: 1, data: btoa(String.fromCharCode(...raw)) });
    expect(Array.from(a.data)).toEqual([0, 128, 255]);
  });
  it("is silent without data", () => {
    expect(levelsAt(null, 3, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(bassAt(null, 3)).toBe(0);
    expect(rmsAt(null, 3)).toBe(0);
  });
  it("resamples bands to bars and is deterministic", () => {
    const a = fake();
    const lv = levelsAt(a, 1, 4, 0);
    expect(lv[0]).toBe(1);
    expect(lv[1]).toBe(0);
    expect(levelsAt(a, 1, 4, 0)).toEqual(lv);
  });
  it("smoothing leaves a decaying tail", () => {
    const a = fake();
    const t1 = levelsAt(a, 2, 8, 0.5)[0], t2 = levelsAt(a, 3, 8, 0.5)[0];
    expect(t1).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(0);
    expect(levelsAt(a, 2, 8, 0)[0]).toBe(0);
  });
  it("clamps out-of-range frames and reads rms", () => {
    const a = fake();
    expect(() => levelsAt(a, 99, 4)).not.toThrow();
    expect(rmsAt(a, 1)).toBeCloseTo(200 / 255);
    expect(bassAt(a, 1, 0)).toBeGreaterThan(0.9);
  });
});

describe("visualizer template", () => {
  it("is registered and has a visualizer plus reactive cover in every aspect", () => {
    expect(TEMPLATES.some((t) => t.id === "visualizer")).toBe(true);
    for (const aspect of ["9:16", "1:1", "4:5", "16:9"] as const) {
      const els = buildElements("visualizer", aspect, { text: "#fff", accent: "#f40", bg: "#111" });
      expect(els.some((e) => e.type === "visualizer" && e.vis)).toBe(true);
      expect(els.find((e) => e.type === "cover")?.reactive).toBeGreaterThan(0);
    }
  });
  it("schema accepts vis and rejects out-of-range values", () => {
    const els = buildElements("visualizer", "9:16", { text: "#ffffff", accent: "#ff4400", bg: "#111111" });
    const v = els.find((e) => e.type === "visualizer")!;
    expect(ProjectSchema.shape.elements.element.safeParse(v).success).toBe(true);
    expect(ProjectSchema.shape.elements.element.safeParse({ ...v, vis: { ...v.vis!, bars: 3 } }).success).toBe(false);
  });
});
