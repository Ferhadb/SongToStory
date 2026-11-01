import { describe, expect, it } from "vitest";
import { defaultPhoto, panFocus, photoRect, playerHeight } from "./photo";
import { PhotoSchema, ProjectSchema, parseProject } from "./schema";
import { createProject, applyTemplate, changeAspect } from "./templates";
import { DEFAULT_COVER } from "./artwork";

describe("photo crop", () => {
  const ph = defaultPhoto("a", 4000, 3000); // landscape photo
  it("covers the canvas and centres by default", () => {
    const r = photoRect(ph, 1080, 1920);
    expect(r.height).toBeCloseTo(1920);
    expect(r.width).toBeGreaterThan(1080);
    expect(r.left).toBeCloseTo((1080 - r.width) / 2);
    expect(r.top).toBeCloseTo(0);
  });
  it("focus pins the edges, zoom enlarges", () => {
    expect(photoRect({ ...ph, focusX: 0 }, 1080, 1920).left).toBeCloseTo(0);
    const right = photoRect({ ...ph, focusX: 1 }, 1080, 1920);
    expect(right.left + right.width).toBeCloseTo(1080);
    expect(photoRect({ ...ph, zoom: 2 }, 1080, 1920).width).toBeCloseTo(2 * photoRect(ph, 1080, 1920).width);
  });
  it("panning follows the pointer, clamps, and ignores an axis with no overflow", () => {
    const r = photoRect(ph, 1080, 1920);
    const moved = panFocus(ph, 1080, 1920, -100, 50);
    expect(photoRect({ ...ph, ...moved }, 1080, 1920).left).toBeCloseTo(r.left - 100);
    expect(moved.focusY).toBe(ph.focusY); // fills the height exactly: nothing to pan vertically
    expect(panFocus(ph, 1080, 1920, 99999, 0).focusX).toBe(0);
    expect(panFocus(ph, 1080, 1920, -99999, 0).focusX).toBe(1);
  });
  it("the same focus keeps the same part of the picture across formats", () => {
    const f = { ...ph, focusX: 0.8 };
    expect(photoRect(f, 1920, 1080).left).toBeCloseTo((1920 - photoRect(f, 1920, 1080).width) * 0.8);
  });
  it("validates", () => {
    expect(PhotoSchema.safeParse(ph).success).toBe(true);
    expect(PhotoSchema.safeParse({ ...ph, zoom: 0.5 }).success).toBe(false);
    expect(PhotoSchema.safeParse({ ...ph, focusX: 2 }).success).toBe(false);
  });
});

const base = () => createProject({
  id: "p", templateId: "photo-story",
  track: { title: "Холод", artists: ["Kai Angel"], album: null, durationMs: 200000, platform: "youtube", sourceUrl: "https://x" },
  audio: { sourceAssetId: "src", sourceDurationMs: 200000, snippetAssetId: "s1", snippet: { startMs: 60000, endMs: 75000, fadeInMs: 0, fadeOutMs: 0, gainDb: 0, normalize: false } },
  artwork: { assetId: "a1", width: 1200, height: 1200, params: DEFAULT_COVER },
  theme: { background: "#202020", text: "#ffffff", accent: "#ff5500" },
});

describe("Photo Story", () => {
  it("is a photo background plus one player card, and round-trips", () => {
    const p = base();
    expect(p.background).toEqual({ type: "photo" });
    expect(p.elements.map((e) => e.type)).toEqual(["player"]);
    const withPhoto = { ...p, photo: defaultPhoto("ph1", 3000, 2000) };
    expect(parseProject(JSON.parse(JSON.stringify(withPhoto)))).toEqual(withPhoto);
    expect(ProjectSchema.safeParse({ ...withPhoto, photo: { ...withPhoto.photo, dim: 5 } }).success).toBe(false);
  });
  it("keeps the photo and the card's settings through format changes", () => {
    const p = base();
    const custom = { ...p, photo: defaultPhoto("ph1", 3000, 2000), elements: p.elements.map((e) => ({ ...e, player: { style: "spotify" as const, title: "My title", artist: null, artwork: null } })) };
    for (const a of ["1:1", "4:5", "16:9", "9:16"] as const) {
      const q = changeAspect(custom, a);
      expect(q.photo).toEqual(custom.photo);
      const pl = q.elements[0];
      expect(pl.player).toEqual(custom.elements[0].player);
      expect(pl.h).toBe(playerHeight("spotify", pl.w));
    }
  });
  it("switching to the template from another keeps the photo", () => {
    const withPhoto = { ...applyTemplate(base(), "classic"), photo: defaultPhoto("ph1", 3000, 2000) };
    const q = applyTemplate(withPhoto, "photo-story");
    expect(q.photo).toEqual(withPhoto.photo);
    expect(q.background).toEqual({ type: "photo" });
  });
  it("places the card inside the safe area on every format", () => {
    for (const a of ["9:16", "1:1", "4:5", "16:9"] as const) {
      const pl = changeAspect(base(), a).elements[0];
      const dims = { "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "16:9": [1920, 1080] }[a];
      expect(pl.x).toBeGreaterThanOrEqual(0);
      expect(pl.x + pl.w).toBeLessThanOrEqual(dims[0]);
      expect(pl.y + pl.h).toBeLessThanOrEqual(dims[1]);
    }
  });
});
