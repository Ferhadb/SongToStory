import { describe, expect, it } from "vitest";
import legacy from "./__fixtures__/legacy-v1.json";
import { ASPECT_IDS, TEMPLATE_VERSION, parseProject, templateVersionOf, type Project, type StoryElement } from "./schema";
import { DEFAULT_COVER } from "./artwork";
import { TEMPLATES, applyTemplate, buildElements, changeAspect, createProject, defaultBackground, defaultEffects, hasNewerDesign, reflowTrackText, resetElement } from "./templates";
import { buildElementsV1 } from "./templates-v1";

const colors = { text: "#ffffff", accent: "#ff5500", bg: "#202020" };
const titles = ["Холод", "Blinding Lights", "A Very Long Song Title That Goes On And On Forever (Remastered 2011 Deluxe Edition)", "Очень длинное название песни которое не помещается в одну строку"];
const OLD = TEMPLATES.filter((t) => t.id !== "photo-story" && t.id !== "lyrics"); // newer than the frozen v1 designs
const snapshot = legacy as Record<string, unknown>;

/** A project as saved before template versioning existed: built by the original layouts, with no templateVersion. */
function savedProject(templateId: string, aspect: (typeof ASPECT_IDS)[number], title = titles[1]): Project {
  const p = createProject({
    id: "old", templateId, aspect,
    track: { title, artists: ["Kai Angel"], album: null, durationMs: 200000, platform: "youtube", sourceUrl: "https://x" },
    audio: { sourceDurationMs: 200000, snippetAssetId: "s1", snippet: { startMs: 0, endMs: 15000, fadeInMs: 0, fadeOutMs: 0, gainDb: 0, normalize: false } },
    artwork: { assetId: "a1", width: 1200, height: 1200, params: DEFAULT_COVER },
    theme: { background: colors.bg, text: colors.text, accent: colors.accent },
  });
  const { templateVersion: _v, typePair: _t, photo: _p, ...rest } = p;
  void _v; void _t; void _p;
  return { ...rest, elements: buildElementsV1(templateId as never, aspect, colors, title) } as Project;
}

describe("frozen v1 layouts", () => {
  it.each(OLD.flatMap((t) => ASPECT_IDS.flatMap((a) => titles.map((_, i) => [t.id, a, i] as const))))("%s @ %s title %i matches the original output", (id, aspect, i) => {
    expect(buildElementsV1(id as never, aspect, colors, titles[i])).toEqual(snapshot[`${id}|${aspect}|${i}`]);
  });
});

describe("template versions", () => {
  it("new projects use the current design; saved ones without a version are design 1", () => {
    const fresh = createProject({ id: "n", track: { title: "T", artists: [], album: null, durationMs: 1, platform: "x", sourceUrl: "u" }, artwork: null, theme: { background: "#111111", text: "#ffffff", accent: "#ff0000" } });
    expect(fresh.templateVersion).toBe(TEMPLATE_VERSION);
    expect(templateVersionOf(savedProject("classic", "9:16"))).toBe(1);
  });

  it("a saved project round-trips through parseProject unchanged", () => {
    for (const t of OLD) {
      const p = savedProject(t.id, "9:16");
      expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    }
  });

  it.each(OLD.flatMap((t) => ASPECT_IDS.map((a) => [t.id, a] as const)))("%s: resizing a saved project to %s keeps its original design", (id, aspect) => {
    const saved = savedProject(id, "9:16");
    const resized = changeAspect(saved, aspect);
    expect(resized.templateVersion).toBeUndefined();
    expect(resized.elements).toEqual(buildElementsV1(id as never, aspect, colors, saved.track.title));
    expect(resized.elements.some((e) => e.coverStyle === "print")).toBe(false);
  });

  it("resetting an element of a saved project restores the original design of that element", () => {
    const saved = savedProject("polaroid", "9:16");
    const cover = saved.elements.find((e) => e.type === "cover")!;
    const moved = { ...saved, elements: saved.elements.map((e) => (e.id === cover.id ? { ...e, x: 3, coverStyle: "plain" as const } : e)) };
    const reset = resetElement(moved, cover.id).elements.find((e) => e.id === cover.id)!;
    expect(reset.coverStyle).toBe("polaroid");
    expect(reset.x).toBe(cover.x);
  });

  it("editing the song title of a saved project does not move its layout", () => {
    const saved = savedProject("minimal", "1:1");
    const next = { ...saved, track: { ...saved.track, title: "Another title entirely" } };
    expect(reflowTrackText(saved, next).elements).toBe(next.elements);
  });

  it("explicitly choosing a template applies the refreshed design, even the one already selected", () => {
    const saved = savedProject("polaroid", "9:16");
    expect(hasNewerDesign(saved)).toBe(true);
    const upgraded = applyTemplate(saved, "polaroid");
    expect(upgraded.templateVersion).toBe(TEMPLATE_VERSION);
    expect(hasNewerDesign(upgraded)).toBe(false);
    expect(upgraded.elements.find((e) => e.type === "cover")!.coverStyle).toBe("print");
    expect(upgraded.elements.some((e) => e.name === "Tape" || e.name === "Print back")).toBe(false);
    // ...and from then on a resize keeps the new design
    expect(changeAspect(upgraded, "1:1").elements.find((e) => e.type === "cover")!.coverStyle).toBe("print");
  });

  it("keeps track, audio, artwork, theme and snippet when upgrading", () => {
    const saved = savedProject("glass", "4:5");
    const up = applyTemplate(saved, "glass");
    expect(up.track).toEqual(saved.track);
    expect(up.audio).toEqual(saved.audio);
    expect(up.artwork).toEqual(saved.artwork);
    expect(up.theme).toEqual(saved.theme);
  });

  it("v1 backgrounds and effects stay selectable by version", () => {
    for (const t of OLD) {
      expect(defaultBackground(t.id as never, colors, 1)).toEqual((snapshot[`bg|${t.id}`] as { bg: unknown }).bg);
      expect(defaultEffects(t.id as never, 1)).toEqual((snapshot[`bg|${t.id}`] as { fx: unknown }).fx);
    }
  });

  it("buildElements at version 1 is the frozen layout", () => {
    const a: StoryElement[] = buildElements("cover-first", "16:9", colors, titles[0], { version: 1 });
    expect(a).toEqual(snapshot["cover-first|16:9|0"]);
  });
});
