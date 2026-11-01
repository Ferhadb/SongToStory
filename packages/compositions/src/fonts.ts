/** Loaders for the bundled fonts (shared by the Story and the cards it draws). */
export const FONT_LOADERS: Record<string, () => Promise<unknown>> = {
  Inter: () => import("@fontsource-variable/inter"),
  Manrope: () => import("@fontsource-variable/manrope"),
  "Playfair Display": () => import("@fontsource-variable/playfair-display"),
  Unbounded: () => import("@fontsource-variable/unbounded"),
  Oswald: () => import("@fontsource-variable/oswald"),
  "JetBrains Mono": () => import("@fontsource-variable/jetbrains-mono"),
  Fraunces: () => import("@fontsource-variable/fraunces"),
};

// @fontsource-variable packages register their family as "<Name> Variable".
export const fam = (f: string) => `"${f} Variable", "${f}", "Inter Variable", "Inter", system-ui, sans-serif`;

/** Typefaces each player style is drawn in. */
export const PLAYER_FONT = { apple: "Inter", "apple-tall": "Inter", spotify: "Manrope" } as const;
