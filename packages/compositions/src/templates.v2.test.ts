import { describe, expect, it } from "vitest";
import { DEFAULT_COVER } from "./artwork";
import { ASPECTS, ASPECT_IDS, type AspectId, type Project, type StoryElement } from "./schema";
import { TEMPLATES, applyTemplate, buildElements, changeAspect, createProject, reflowTrackText, setTypePair } from "./templates";
import { TYPE_PAIRS, pairSupports } from "./typography";
import { fitText, lineCount, textWidth } from "./measure";

const titles = [
  "Холод",
  "Blinding Lights",
  "A Very Long Song Title That Goes On And On Forever (Remastered 2011 Deluxe Edition)",
  "Очень длинное название песни которое не помещается в одну строку",
  "Supercalifragilisticexpialidocious_Unbroken_Word_Without_Any_Spaces_At_All",
  "Я",
];
const artists = ["Kai Angel", "Группа Крови & Кино feat. Очень Длинное Имя Исполнителя"];
const colors = { text: "#ffffff", accent: "#ff5500", bg: "#202020" };
const rect = (e: StoryElement) => ({ l: e.x, t: e.y, r: e.x + e.w, b: e.y + e.h });
const overlaps = (a: StoryElement, b: StoryElement) => {
  const A = rect(a), B = rect(b);
  return A.l < B.r - 1 && B.l < A.r - 1 && A.t < B.b - 1 && B.t < A.b - 1;
};
const by = (els: StoryElement[], name: string) => els.find((e) => e.name === name);

const CASES = TEMPLATES.flatMap((t) => ASPECT_IDS.flatMap((a) => titles.flatMap((title, i) => artists.map((artist, j) => [t.id, a, title, artist, `${i}/${j}`] as const))));

describe("v2 layouts hold up for any title", () => {
  it.each(CASES)("%s @ %s — %s / %s (%s)", (id, aspect, title, artist) => {
    const els = buildElements(id as never, aspect, colors, title, { artist });
    const { w: W, h: H } = ASPECTS[aspect];
    for (const e of els.filter((e) => e.type !== "shape" && !e.name.startsWith("Marquee"))) {
      expect(e.x, `${e.name} x`).toBeGreaterThanOrEqual(-1);
      expect(e.y, `${e.name} y`).toBeGreaterThanOrEqual(-1);
      expect(e.x + e.w, `${e.name} right`).toBeLessThanOrEqual(W + 1);
      expect(e.y + e.h, `${e.name} bottom`).toBeLessThanOrEqual(H + 1);
    }
    const stack = ["Kicker", "Title", "Artist", "Progress", "Elapsed", "Controls"].map((n) => by(els, n)).filter(Boolean) as StoryElement[];
    for (let i = 0; i < stack.length; i++) for (let j = i + 1; j < stack.length; j++) {
      expect(overlaps(stack[i], stack[j]), `${stack[i].name} overlaps ${stack[j].name}`).toBe(false);
    }
    const media = els.find((e) => e.type === "cover" || e.type === "player" || e.name === "Ring");
    expect(media, "has a hero").toBeTruthy();
    const titleEl = by(els, "Title");
    if (titleEl && media && id !== "minimal") expect(overlaps(media, titleEl), "hero overlaps the title").toBe(false);
    if (titleEl?.text) {
      const t = titleEl.text;
      expect(t.fontSize).toBeGreaterThanOrEqual(1);
      expect(t.maxLines * t.fontSize * t.lineHeight).toBeLessThanOrEqual(titleEl.h + 1);
    }
  });

  it("scales the song title to the text instead of reserving a fixed size", () => {
    const short = by(buildElements("minimal", "9:16", colors, "Я"), "Title")!.text!.fontSize;
    const long = by(buildElements("minimal", "9:16", colors, titles[3]), "Title")!.text!.fontSize;
    expect(short).toBeGreaterThan(long * 1.8);
  });

  it("the title block hugs a one-line title (no phantom lines)", () => {
    const one = by(buildElements("classic", "9:16", colors, "Hello"), "Title")!;
    const many = by(buildElements("classic", "9:16", colors, titles[2]), "Title")!;
    expect(many.h).toBeGreaterThan(one.h * 1.5);
  });
});

describe("Spectrum Ring and Instant Print", () => {
  it("Spectrum Ring sets the artist in tracked small capitals", () => {
    const a = by(buildElements("visualizer", "9:16", colors, "Blinding Lights", { artist: "The Weeknd" }), "Artist")!.text!;
    expect(a.uppercase).toBe(true);
    expect(a.letterSpacing).toBeGreaterThan(2);
    expect(by(buildElements("visualizer", "9:16", colors, "Blinding Lights"), "Title")!.text!.fontFamily).toBe("Unbounded");
  });
  it("Instant Print is one clean card: no stacked prints or tape", () => {
    for (const a of ASPECT_IDS) {
      const els = buildElements("polaroid", a, colors, "Blinding Lights");
      expect(els.filter((e) => e.type === "shape")).toHaveLength(0);
      expect(els.filter((e) => e.type === "cover")).toHaveLength(1);
      expect(els.find((e) => e.type === "cover")!.coverStyle).toBe("print");
      expect(els.find((e) => e.type === "cover")!.rotation).toBe(0);
    }
  });
});

const proj = (templateId = "classic", aspect: AspectId = "9:16", title = "Blinding Lights", artist = "The Weeknd"): Project =>
  createProject({
    id: "p", templateId, aspect,
    track: { title, artists: [artist], album: "After Hours", durationMs: 200000, platform: "youtube", sourceUrl: "https://x" },
    audio: { sourceDurationMs: 200000, snippetAssetId: "s1", snippet: { startMs: 0, endMs: 15000, fadeInMs: 0, fadeOutMs: 0, gainDb: 0, normalize: false } },
    artwork: { assetId: "a1", width: 1200, height: 1200, params: DEFAULT_COVER },
    theme: { background: colors.bg, text: colors.text, accent: colors.accent },
  });

describe("reflow after text edits", () => {
  it("refits an untouched title when the song name changes", () => {
    const p = proj();
    const next = { ...p, track: { ...p.track, title: titles[2] } };
    const re = reflowTrackText(p, next);
    const t = by(re.elements, "Title")!;
    expect(t.id).toBe(by(p.elements, "Title")!.id);
    expect(t.h).toBeGreaterThan(by(p.elements, "Title")!.h);
    expect(re.elements.map((e) => e.id)).toEqual(p.elements.map((e) => e.id));
    expect(re).toEqual({ ...next, elements: re.elements });
    expect(re.elements).toEqual(buildElements("classic", "9:16", colors, titles[2], { artist: "The Weeknd" }).map((e, i) => ({ ...e, id: p.elements[i].id })));
  });
  it("keeps elements the user already moved or restyled", () => {
    const p = proj();
    const moved = { ...p, elements: p.elements.map((e) => (e.type === "cover" ? { ...e, x: e.x + 40 } : e.name === "Artist" ? { ...e, text: { ...e.text!, color: "#00ff00" } } : e)) };
    const re = reflowTrackText(moved, { ...moved, track: { ...moved.track, title: titles[2] } });
    expect(by(re.elements, "Artist")!.text!.color).toBe("#00ff00");
    expect(re.elements.find((e) => e.type === "cover")!.x).toBe(moved.elements.find((e) => e.type === "cover")!.x);
  });
  it("is a no-op when only unrelated fields changed", () => {
    const p = proj();
    const next = { ...p, track: { ...p.track, album: "Other" } };
    expect(reflowTrackText(p, next)).toBe(next);
  });
});

describe("typography", () => {
  it("applies a curated pair across the text, keeps ids, and survives a format change", () => {
    const p = proj();
    const q = setTypePair(p, "editorial");
    expect(q.typePair).toBe("editorial");
    expect(by(q.elements, "Title")!.text!.fontFamily).toBe("Playfair Display");
    expect(by(q.elements, "Artist")!.text!.fontFamily).toBe("JetBrains Mono");
    expect(by(q.elements, "Artist")!.text!.uppercase).toBe(true);
    expect(q.elements.map((e) => e.id)).toEqual(p.elements.map((e) => e.id));
    expect(by(changeAspect(q, "1:1").elements, "Title")!.text!.fontFamily).toBe("Playfair Display");
    expect(by(setTypePair(q, undefined).elements, "Title")!.text!.fontFamily).toBe("Manrope");
  });
  it("restyles hand-edited text with the new fonts but leaves its colour and position", () => {
    const p = proj();
    const edited = { ...p, elements: p.elements.map((e) => (e.name === "Title" ? { ...e, x: e.x + 10, text: { ...e.text!, color: "#00ff00" } } : e)) };
    const t = by(setTypePair(edited, "poster").elements, "Title")!;
    expect(t.text!.fontFamily).toBe("Oswald");
    expect(t.text!.color).toBe("#00ff00");
    expect(t.x).toBe(by(edited.elements, "Title")!.x);
  });
  it("the pair is dropped when another template is chosen", () => {
    expect(applyTemplate(setTypePair(proj(), "modern"), "glass").typePair).toBeUndefined();
  });
  it("flags pairs whose heading font lacks Cyrillic", () => {
    const soft = TYPE_PAIRS.find((t) => t.id === "soft")!;
    expect(pairSupports(soft, "Холод")).toBe(false);
    expect(pairSupports(soft, "Blinding Lights")).toBe(true);
    expect(TYPE_PAIRS.filter((t) => !pairSupports(t, "Холод")).map((t) => t.id)).toEqual(["soft"]);
  });
});

describe("text measurement", () => {
  it("is wider for heavier weights, capitals and Cyrillic", () => {
    expect(textWidth("Hello", "Inter", 100, { weight: 800 })).toBeGreaterThan(textWidth("Hello", "Inter", 100, { weight: 400 }));
    expect(textWidth("hello", "Inter", 100, { upper: true })).toBeGreaterThan(textWidth("hello", "Inter", 100));
    expect(textWidth("привет", "Inter", 100)).toBeGreaterThan(textWidth("privet", "Inter", 100));
  });
  it("counts lines, breaking over-long words", () => {
    expect(lineCount("one two", "Inter", 40, 2000)).toBe(1);
    expect(lineCount("word ".repeat(40), "Inter", 40, 600)).toBeGreaterThan(5);
    expect(lineCount("x".repeat(200), "Inter", 40, 600)).toBeGreaterThan(5);
  });
  it("fitText picks the largest size that fits and reports misses", () => {
    const f = fitText("Hello", { font: "Inter", maxW: 1000, maxLines: 1, maxSize: 100, minSize: 20 });
    expect(f).toMatchObject({ size: 100, lines: 1, fits: true });
    const g = fitText("x".repeat(400), { font: "Inter", maxW: 300, maxLines: 1, maxSize: 100, minSize: 20 });
    expect(g.fits).toBe(false);
    expect(g.size).toBe(20);
  });
});
