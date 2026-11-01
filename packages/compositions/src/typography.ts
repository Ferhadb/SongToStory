import { hasCyrillic } from "./measure";

export interface TypeRole { font: string; weight: number; upper?: boolean; /** letter-spacing in em */ track?: number }
export interface TypePair {
  id: string; name: string; note: string;
  heading: TypeRole; body: TypeRole;
  /** The heading font has no Cyrillic glyphs. */
  latinOnly?: boolean;
}

/** The curated typography choices offered in Design. Each pairs a heading (song title) with a body face (artist, times). */
export const TYPE_PAIRS: readonly TypePair[] = [
  { id: "clean", name: "Clean", note: "Friendly, round sans", heading: { font: "Manrope", weight: 800, track: -0.02 }, body: { font: "Manrope", weight: 500 } },
  { id: "neutral", name: "Neutral", note: "Plain and quiet", heading: { font: "Inter", weight: 700, track: -0.02 }, body: { font: "Inter", weight: 500 } },
  { id: "editorial", name: "Editorial", note: "Serif with mono credits", heading: { font: "Playfair Display", weight: 700, track: -0.01 }, body: { font: "JetBrains Mono", weight: 500, upper: true, track: 0.1 } },
  { id: "soft", name: "Soft serif", note: "Warm, literary", heading: { font: "Fraunces", weight: 600, track: -0.01 }, body: { font: "Inter", weight: 500 }, latinOnly: true },
  { id: "poster", name: "Poster", note: "Tall condensed capitals", heading: { font: "Oswald", weight: 700, upper: true, track: -0.01 }, body: { font: "Oswald", weight: 400, upper: true, track: 0.12 } },
  { id: "modern", name: "Modern", note: "Wide geometric display", heading: { font: "Unbounded", weight: 500, track: -0.01 }, body: { font: "Inter", weight: 500 } },
];

export const typePairOf = (id: string | undefined) => TYPE_PAIRS.find((t) => t.id === id);

/** A pair is usable unless its heading font lacks glyphs for the text on the card. */
export const pairSupports = (t: TypePair, ...texts: string[]) => !(t.latinOnly && texts.some(hasCyrillic));
