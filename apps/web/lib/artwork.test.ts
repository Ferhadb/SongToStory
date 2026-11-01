import { describe, expect, it } from "vitest";
import {
  DEFAULT_COVER, contrast, coverFilter, extractPalette, hashString, isDefault,
  mulberry32, seedColors, themeFromPalette, toHex, wrapLines,
} from "./artwork";

function pixels(parts: [number, number, number, number][]) {
  return new Uint8ClampedArray(parts.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat()));
}

describe("palette", () => {
  it("returns dominant colors in order of weight", () => {
    const p = extractPalette(pixels([[220, 30, 30, 70], [20, 40, 200, 30]]));
    expect(p).toHaveLength(2);
    expect(p[0][0]).toBeGreaterThan(200);
    expect(p[1][2]).toBeGreaterThan(180);
  });
  it("merges near-identical shades and ignores transparent pixels", () => {
    const rgba = new Uint8ClampedArray([...pixels([[200, 20, 20, 50], [205, 22, 18, 50]]), 0, 255, 0, 0]);
    expect(extractPalette(rgba)).toHaveLength(1);
  });
  it("handles empty input", () => {
    expect(extractPalette(new Uint8ClampedArray())).toEqual([]);
    expect(themeFromPalette([]).background).toBeDefined();
  });
});

describe("theme", () => {
  it.each([[[250, 240, 200]], [[10, 10, 40]], [[200, 30, 30]]] as [number, number, number][][])(
    "text is readable on the suggested background (%j)",
    (c) => {
      const t = themeFromPalette([c as [number, number, number]]);
      expect(contrast(t.background, t.text)).toBeGreaterThanOrEqual(4.5);
    },
  );
  it("contrast is symmetric and 21 for black/white", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrast([10, 20, 30], [200, 210, 220])).toBeCloseTo(contrast([200, 210, 220], [10, 20, 30]));
  });
  it("toHex", () => expect(toHex([255, 0, 128])).toBe("#ff0080"));
});

describe("cover params", () => {
  it("default has neutral filter and is detected as default", () => {
    expect(coverFilter(DEFAULT_COVER, 1080)).toBe("brightness(100%) contrast(100%) saturate(100%)");
    expect(isDefault(DEFAULT_COVER)).toBe(true);
    expect(isDefault({ ...DEFAULT_COVER, zoom: 2 })).toBe(false);
  });
  it("blur scales with output size so preview matches export", () => {
    const p = { ...DEFAULT_COVER, blur: 10 };
    expect(coverFilter(p, 540)).toContain("blur(5.00px)");
    expect(coverFilter(p, 1080)).toContain("blur(10.00px)");
  });
  it("prng and hash are deterministic", () => {
    const a = mulberry32(7), b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(hashString("Холод")).toBe(hashString("Холод"));
    expect(seedColors("x")).toEqual(seedColors("x"));
    expect(seedColors("x")).not.toEqual(seedColors("y"));
  });
});

describe("wrapLines", () => {
  const measure = (s: string) => s.length * 10;
  it("wraps and truncates with an ellipsis", () => {
    expect(wrapLines(measure, "aa bb cc dd", 50, 5)).toEqual(["aa bb", "cc dd"]);
    const l = wrapLines(measure, "one two three four five six", 70, 2);
    expect(l).toHaveLength(2);
    expect(l[1].endsWith("…")).toBe(true);
  });
  it("never drops a single overlong word", () => {
    expect(wrapLines(measure, "supercalifragilistic", 50, 2)).toEqual(["supercalifragilistic"]);
  });
});
