import { beforeEach, describe, expect, it } from "vitest";
import { TEMPLATE_VERSION, createProject, DEFAULT_COVER, durationMsOf, parseProject, playerHeight, templateVersionOf } from "@mss/compositions";
import { useEditor } from "./store";

const mkProject = () =>
  createProject({
    id: "t", track: { title: "T", artists: ["A"], album: null, durationMs: 1000, platform: "deezer", sourceUrl: "https://x" },
    artwork: { assetId: "a", width: 100, height: 100, params: DEFAULT_COVER },
    theme: { background: "#111111", text: "#ffffff", accent: "#ff0000" },
  });

beforeEach(() => useEditor.getState().load(mkProject()));

describe("editor history", () => {
  it("undoes and redoes", () => {
    const s = useEditor.getState();
    const id = s.project!.elements[0].id;
    s.editElement(id, { x: 11 });
    expect(useEditor.getState().project!.elements[0].x).toBe(11);
    useEditor.getState().undo();
    expect(useEditor.getState().project!.elements[0].x).not.toBe(11);
    useEditor.getState().redo();
    expect(useEditor.getState().project!.elements[0].x).toBe(11);
  });
  it("coalesces same-key edits into one step", () => {
    const id = useEditor.getState().project!.elements[0].id;
    for (const x of [1, 2, 3]) useEditor.getState().editElement(id, { x }, "slider");
    expect(useEditor.getState().past).toHaveLength(1);
  });
  it("a gesture is one undo step", () => {
    const id = useEditor.getState().project!.elements[0].id;
    useEditor.getState().beginGesture();
    for (const x of [5, 6, 7]) useEditor.getState().live((d) => { d.elements.find((e) => e.id === id)!.x = x; });
    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().project!.elements[0].x).not.toBe(7);
  });
  it("new edit clears redo", () => {
    const id = useEditor.getState().project!.elements[0].id;
    useEditor.getState().editElement(id, { x: 1 }, "a");
    useEditor.getState().undo();
    useEditor.getState().editElement(id, { x: 2 }, "b");
    expect(useEditor.getState().future).toHaveLength(0);
  });
});

describe("element actions", () => {
  it("adds, duplicates, reorders and removes with undo", () => {
    const n = useEditor.getState().project!.elements.length;
    useEditor.getState().addText();
    expect(useEditor.getState().project!.elements).toHaveLength(n + 1);
    const id = useEditor.getState().selectedId!;
    useEditor.getState().duplicate(id);
    expect(useEditor.getState().project!.elements).toHaveLength(n + 2);
    const dup = useEditor.getState().selectedId!;
    expect(dup).not.toBe(id);
    useEditor.getState().reorder(dup, -1);
    const ids = useEditor.getState().project!.elements.map((e) => e.id);
    expect(ids.indexOf(dup)).toBeLessThan(ids.indexOf(id));
    useEditor.getState().remove(dup);
    expect(useEditor.getState().project!.elements.some((e) => e.id === dup)).toBe(false);
    useEditor.getState().undo();
    expect(useEditor.getState().project!.elements.some((e) => e.id === dup)).toBe(true);
  });
});

describe("Photo Story", () => {
  const photo = { assetId: "p1", width: 4000, height: 3000, zoom: 1, focusX: 0.5, focusY: 0.5, dim: 0.25 };
  const toPhotoStory = () => { useEditor.getState().chooseTemplate("photo-story"); return useEditor.getState().project!; };
  const player = () => useEditor.getState().project!.elements.find((e) => e.type === "player")!;

  it("choosing the template gives a photo background and a player card", () => {
    const p = toPhotoStory();
    expect(p.templateId).toBe("photo-story");
    expect(p.background.type).toBe("photo");
    expect(player().player!.style).toBe("apple");
    expect(() => parseProject(JSON.parse(JSON.stringify(p)))).not.toThrow();
  });
  it("photo upload, crop and removal are undoable", () => {
    toPhotoStory();
    const s = () => useEditor.getState();
    s().setPhoto(photo);
    s().editPhoto({ zoom: 2, focusX: 0.2 }, "crop");
    expect(s().project!.photo).toMatchObject({ zoom: 2, focusX: 0.2, assetId: "p1" });
    s().removePhoto();
    expect(s().project!.photo).toBeNull();
    s().undo();
    expect(s().project!.photo?.zoom).toBe(2);
    s().undo(); s().undo();
    expect(s().project!.photo ?? null).toBeNull();
    s().redo();
    expect(s().project!.photo?.assetId).toBe("p1");
  });
  it("the crop survives a format change", () => {
    toPhotoStory();
    useEditor.getState().setPhoto({ ...photo, zoom: 1.8, focusX: 0.3, focusY: 0.7 });
    for (const a of ["1:1", "16:9", "4:5", "9:16"] as const) {
      useEditor.getState().chooseAspect(a);
      expect(useEditor.getState().project!.photo).toMatchObject({ zoom: 1.8, focusX: 0.3, focusY: 0.7 });
      expect(useEditor.getState().project!.background.type).toBe("photo");
    }
  });
  it("switching player style keeps the card's proportions, text overrides are undoable", () => {
    toPhotoStory();
    const id = player().id;
    const w = player().w;
    useEditor.getState().editPlayer(id, { style: "spotify" });
    expect(player().player!.style).toBe("spotify");
    expect(player().h).toBe(playerHeight("spotify", w));
    useEditor.getState().editPlayer(id, { title: "Другая песня" }, "t");
    expect(player().player!.title).toBe("Другая песня");
    useEditor.getState().undo();
    expect(player().player!.title).toBeNull();
    useEditor.getState().undo();
    expect(player().player!.style).toBe("apple");
  });
  it("changing the clip updates audio in one undo step and leaves the layout alone", () => {
    toPhotoStory();
    const before = useEditor.getState().project!;
    const sn = { startMs: 20000, endMs: 32000, fadeInMs: 300, fadeOutMs: 600, gainDb: 0, normalize: false };
    useEditor.getState().setClip("snip2", sn);
    const after = useEditor.getState().project!;
    expect(after.audio).toMatchObject({ snippetAssetId: "snip2", snippet: sn });
    expect(durationMsOf(after)).toBe(12000);
    expect(after.elements).toEqual(before.elements);
    useEditor.getState().undo();
    expect(useEditor.getState().project!.audio.snippetAssetId).toBe(before.audio.snippetAssetId);
  });
});

describe("design versions", () => {
  it("keeps an older project's layout across format changes and typography, upgrades on choosing a template", () => {
    const legacy = { ...mkProject(), templateVersion: undefined };
    useEditor.getState().load(legacy);
    useEditor.getState().chooseAspect("1:1"); // lays the project out with its own (v1) design
    useEditor.getState().chooseAspect("9:16");
    const first = useEditor.getState().project!.elements;
    useEditor.getState().chooseAspect("16:9");
    useEditor.getState().chooseAspect("9:16");
    expect(templateVersionOf(useEditor.getState().project!)).toBe(1);
    expect(useEditor.getState().project!.elements).toEqual(first);
    useEditor.getState().chooseTypePair("poster");
    expect(useEditor.getState().project!.elements).toEqual(first);
    useEditor.getState().editTrack({ title: "A much longer replacement title for the song" });
    expect(useEditor.getState().project!.elements).toEqual(first);
    useEditor.getState().chooseTemplate("classic");
    expect(templateVersionOf(useEditor.getState().project!)).toBe(TEMPLATE_VERSION);
  });
  it("refits the untouched title block when the title changes, and one undo reverts text and layout together", () => {
    const title = () => useEditor.getState().project!.elements.find((e) => e.type === "title")!;
    const short = title().text!.fontSize;
    useEditor.getState().editTrack({ title: "Симфония номер пять до минор, часть первая" }, "x");
    expect(title().text!.fontSize).toBeLessThan(short);
    useEditor.getState().undo();
    expect(useEditor.getState().project!.track.title).toBe("T");
    expect(title().text!.fontSize).toBe(short);
  });
  it("hand-edited elements are not moved by a title change", () => {
    const id = useEditor.getState().project!.elements.find((e) => e.type === "title")!.id;
    useEditor.getState().editElement(id, { x: 123 });
    useEditor.getState().editTrack({ title: "Another title entirely" });
    expect(useEditor.getState().project!.elements.find((e) => e.id === id)!.x).toBe(123);
  });
});
