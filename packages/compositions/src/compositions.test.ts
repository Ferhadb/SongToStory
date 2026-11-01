import { describe, expect, it } from "vitest";
import { animationAt, ease } from "./animations";
import { resizeRect, snapMove } from "./layout";
import { progressAt } from "./progress";
import { ASPECTS, ASPECT_IDS, DEFAULT_LYRICS, parseProject, durationFramesOf } from "./schema";
import { TEMPLATES, applyTemplate, changeAspect, createProject, resetElement } from "./templates";
import { DEFAULT_COVER } from "./artwork";
import { activeAt, fitLyrics, lineTop, slotOf, slotOpacity, SWITCH_MS } from "./lyrics";

const base = () =>
  createProject({
    id: "p1",
    track: { title: "Холод", artists: ["Kai Angel"], album: null, durationMs: 200000, platform: "youtube", sourceUrl: "https://x" },
    audio: { sourceDurationMs: 200000, snippetAssetId: "s1", snippet: { startMs: 60000, endMs: 75000, fadeInMs: 300, fadeOutMs: 600, gainDb: 0, normalize: false } },
    artwork: { assetId: "a1", width: 1200, height: 1200, params: DEFAULT_COVER },
    theme: { background: "#202020", text: "#ffffff", accent: "#ff5500" },
  });

describe("animations", () => {
  const a = { type: "fade", startMs: 0, durationMs: 1000, easing: "linear", intensity: 1 } as const;
  const none = { ...a, type: "none" } as const;
  it("is hidden before start, settled after", () => {
    expect(animationAt(a, none, 0, 30, 300).opacity).toBe(0);
    expect(animationAt(a, none, 15, 30, 300).opacity).toBeCloseTo(0.5);
    expect(animationAt(a, none, 100, 30, 300).opacity).toBe(1);
  });
  it("exit anchors to the end", () => {
    const out = { ...a, startMs: 0 };
    expect(animationAt(none, out, 0, 30, 300).opacity).toBe(1);
    expect(animationAt(none, out, 300, 30, 300).opacity).toBe(0);
  });
  it("is deterministic and eases within 0..1", () => {
    for (const k of ["linear", "ease-out", "ease-in-out"] as const) for (const t of [-1, 0, 0.3, 1, 2]) expect(ease(k, t)).toBeGreaterThanOrEqual(0);
  });
});

describe("templates", () => {
  it.each(TEMPLATES.flatMap((t) => ASPECT_IDS.map((a) => [t.id, a] as const)))("%s @ %s fits canvas", (id, aspect) => {
    const p = applyTemplate(base(), id, aspect);
    const { w, h } = ASPECTS[aspect];
    for (const e of p.elements.filter((e) => e.type !== "shape")) { // decor shapes may bleed off the edge on purpose
      expect(e.x, `${e.name} x`).toBeGreaterThanOrEqual(-1);
      expect(e.y, `${e.name} y`).toBeGreaterThanOrEqual(-1);
      expect(e.x + e.w, `${e.name} right`).toBeLessThanOrEqual(w + 1);
      expect(e.y + e.h, `${e.name} bottom`).toBeLessThanOrEqual(h + 1);
    }
    expect(p.elements.some((e) => e.type === (id === "photo-story" ? "player" : "cover"))).toBe(true);
  });
  it("switching keeps track, audio, artwork and snippet", () => {
    const p = base();
    const q = applyTemplate(p, "glass");
    expect(q.track).toEqual(p.track);
    expect(q.audio).toEqual(p.audio);
    expect(q.artwork).toEqual(p.artwork);
    expect(changeAspect(q, "1:1").templateId).toBe("glass");
  });
  it("resets one element", () => {
    const p = base();
    const t = p.elements.find((e) => e.type === "title")!;
    const moved = { ...p, elements: p.elements.map((e) => (e.id === t.id ? { ...e, x: 5 } : e)) };
    expect(resetElement(moved, t.id).elements.find((e) => e.id === t.id)!.x).toBe(t.x);
  });
});

describe("schema and progress", () => {
  it("round-trips and rejects other versions", () => {
    const p = base();
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => parseProject({ ...p, schemaVersion: 99 })).toThrow();
  });
  it("duration follows the snippet", () => {
    expect(durationFramesOf(base())).toBe(450);
  });
  it("snippet vs original progress", () => {
    const p = base();
    expect(progressAt(p, 225).fraction).toBeCloseTo(0.5);
    const o = progressAt({ ...p, progress: { mode: "original" } }, 0);
    expect(o.elapsedMs).toBe(60000);
    expect(o.totalMs).toBe(200000);
    expect(o.fraction).toBeCloseTo(0.3);
  });
});

describe("layout", () => {
  const canvas = { w: 1000, h: 1000 };
  it("snaps to center and reports a guide", () => {
    const r = snapMove({ x: 395, y: 100, w: 200, h: 100 }, [], canvas, 8);
    expect(r.rect.x).toBe(400);
    expect(r.guides).toContainEqual({ axis: "x", pos: 500 });
  });
  it("does not snap outside threshold", () => {
    expect(snapMove({ x: 330, y: 330, w: 100, h: 100 }, [], canvas, 8).rect).toEqual({ x: 330, y: 330, w: 100, h: 100 });
  });
  it("resize keeps aspect and min size", () => {
    const r = resizeRect({ x: 0, y: 0, w: 200, h: 100 }, "se", 100, 0, true);
    expect(r.w / r.h).toBeCloseTo(2);
    expect(resizeRect({ x: 0, y: 0, w: 200, h: 100 }, "e", -500, 0, false).w).toBe(20);
  });
  it("west resize anchors the right edge", () => {
    const r = resizeRect({ x: 100, y: 0, w: 200, h: 100 }, "w", 50, 0, false);
    expect(r.x + r.w).toBe(300);
  });
});

describe("lyrics", () => {
  const lines = [{ startMs: 1000, endMs: 2000, text: "a" }, { startMs: 2000, endMs: 3000, text: "b" }];
  it("picks the active line and switch progress", () => {
    expect(activeAt(lines, 500)).toEqual({ idx: -1, t: 1 });
    expect(activeAt(lines, 1000)).toEqual({ idx: 0, t: 0 });
    expect(activeAt(lines, 2000 + SWITCH_MS / 2).idx).toBe(1);
    expect(activeAt(lines, 9000)).toEqual({ idx: 1, t: 1 });
  });
  it("slides the stack one slot per switch", () => {
    expect(slotOf(1, 1, 0)).toBe(1); // new active line still sits in the "next" slot
    expect(slotOf(1, 1, 1)).toBe(0);
    expect(slotOpacity(0)).toBe(1);
    expect(slotOpacity(1)).toBeCloseTo(0.35);
    expect(slotOpacity(2)).toBe(0);
  });
  it("fits three lines in the element at the largest size, wrapping long lines", () => {
    const f = fitLyrics(["short", "a much longer line that has to wrap across several rows of text", "short"], "Inter", {}, 800, 500, 100);
    expect(f.size).toBeLessThanOrEqual(100);
    expect(f.heights[1]).toBeGreaterThan(f.heights[0]);
    expect(f.heights[0] + f.heights[1] + f.heights[2] + 2 * f.gap).toBeLessThanOrEqual(500);
    expect(lineTop(1, 1, 250, f) + f.heights[1] / 2).toBeCloseTo(250); // active line centred
    expect(lineTop(2, 1, 250, f)).toBeCloseTo(lineTop(1, 1, 250, f) + f.heights[1] + f.gap);
  });
  it("the Lyrics template keeps its lyrics area inside the canvas, below the header and above the footer", () => {
    for (const aspect of ASPECT_IDS) {
      const p = changeAspect(applyTemplate(base(), "lyrics"), aspect);
      const L = p.elements.find((e) => e.type === "lyrics")!;
      const { w, h } = ASPECTS[aspect];
      const header = Math.max(...p.elements.filter((e) => e.type === "cover" || e.type === "title" || e.type === "artist").map((e) => e.y + e.h));
      const footer = Math.min(...p.elements.filter((e) => e.type === "progress").map((e) => e.y));
      expect(L.y, aspect).toBeGreaterThanOrEqual(header);
      expect(L.y + L.h, aspect).toBeLessThanOrEqual(footer);
      expect(L.x + L.w).toBeLessThanOrEqual(w);
      expect(L.h).toBeGreaterThan(h * 0.15);
    }
  });
  it("old projects without lyrics still parse", () => {
    const raw = JSON.parse(JSON.stringify(base()));
    expect(parseProject(raw).lyrics).toBeUndefined();
    expect(parseProject({ ...raw, lyrics: { ...DEFAULT_LYRICS, lines } }).lyrics?.lines).toHaveLength(2);
  });
});
