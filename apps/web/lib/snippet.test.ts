import { describe, expect, it } from "vitest";
import { defaultSnippet, durationOf, fit, previewGain, withDuration } from "./snippet";

const TRACK = 200_000;

describe("snippet", () => {
  it("default is 15s inside the track", () => {
    const s = defaultSnippet(TRACK);
    expect(durationOf(s)).toBe(15_000);
    expect(s.endMs).toBeLessThanOrEqual(TRACK);
  });
  it("short tracks use the whole track", () => {
    const s = defaultSnippet(8_000);
    expect([s.startMs, s.endMs]).toEqual([0, 8_000]);
  });
  it("fit clamps ranges and enforces min length", () => {
    const s = fit({ ...defaultSnippet(TRACK), startMs: -500, endMs: -100 }, TRACK);
    expect(s.startMs).toBe(0);
    expect(durationOf(s)).toBe(1000);
    const t = fit({ ...defaultSnippet(TRACK), startMs: TRACK - 100, endMs: TRACK + 5000 }, TRACK);
    expect(t.endMs).toBe(TRACK);
    expect(durationOf(t)).toBe(1000);
  });
  it("fades never exceed the snippet", () => {
    const s = fit({ startMs: 0, endMs: 2000, fadeInMs: 1500, fadeOutMs: 1500, gainDb: 0, normalize: false }, TRACK);
    expect(s.fadeInMs + s.fadeOutMs).toBeLessThanOrEqual(2000);
  });
  it("withDuration shifts left at the end of the track", () => {
    const s = withDuration({ ...defaultSnippet(TRACK), startMs: 190_000, endMs: 195_000 }, 30_000, TRACK);
    expect([s.startMs, s.endMs]).toEqual([170_000, 200_000]);
  });
  it("previewGain follows fades and gain", () => {
    const s = { startMs: 1000, endMs: 11_000, fadeInMs: 2000, fadeOutMs: 2000, gainDb: 0, normalize: false };
    expect(previewGain(s, 1000)).toBe(0);
    expect(previewGain(s, 2000)).toBeCloseTo(0.5);
    expect(previewGain(s, 6000)).toBe(1);
    expect(previewGain(s, 10_000)).toBeCloseTo(0.5);
    expect(previewGain({ ...s, gainDb: -6 }, 6000)).toBeCloseTo(0.501, 2);
  });
});
