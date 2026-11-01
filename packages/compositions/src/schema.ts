import { z } from "zod";

export const SCHEMA_VERSION = 1;
/**
 * Version of the template *designs* (layouts, type, default backgrounds). Independent of SCHEMA_VERSION: the data shape is
 * unchanged, but projects saved before this existed have no `templateVersion` and stay on design 1 until the user picks a
 * template again.
 */
export const TEMPLATE_VERSION = 2;

export const ASPECTS = {
  "9:16": { w: 1080, h: 1920, label: "Story · Reel · Short" },
  "1:1": { w: 1080, h: 1080, label: "Square post" },
  "4:5": { w: 1080, h: 1350, label: "Portrait post" },
  "16:9": { w: 1920, h: 1080, label: "Landscape" },
} as const;
export type AspectId = keyof typeof ASPECTS;
export const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const AnimSchema = z.object({
  type: z.enum(["none", "fade", "slide-up", "slide-down", "scale", "blur"]),
  startMs: z.number().min(0),
  durationMs: z.number().min(0),
  easing: z.enum(["linear", "ease-out", "ease-in-out"]),
  intensity: z.number().min(0).max(3),
});
export type Anim = z.infer<typeof AnimSchema>;

export const TextStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number().min(8).max(400),
  fontWeight: z.number().min(100).max(900),
  letterSpacing: z.number().min(-10).max(40),
  lineHeight: z.number().min(0.7).max(2.5),
  color: hex,
  align: z.enum(["left", "center", "right"]),
  maxLines: z.number().int().min(1).max(8),
  shadow: z.boolean(),
  uppercase: z.boolean(),
  valign: z.enum(["top", "middle", "bottom"]).optional(), // where text sits in a taller box
  outline: z.boolean().optional(), // stroke-only lettering
  scroll: z.number().min(-2000).max(2000).optional(), // marquee speed in px/s (0 / absent = static)
  balance: z.boolean().optional(), // even out line lengths in multi-line text
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const ELEMENT_TYPES = ["cover", "title", "artist", "album", "text", "source", "time", "progress", "controls", "panel", "visualizer", "shape", "player"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const PLAYER_STYLES = ["apple", "apple-tall", "spotify"] as const;
export type PlayerStyle = (typeof PLAYER_STYLES)[number];

/** The music-player card drawn over a photo. Text and artwork default to the track's; set to override just on the card. */
export const PlayerSchema = z.object({
  style: z.enum(PLAYER_STYLES),
  tone: z.enum(["dark", "light"]).optional(), // Apple styles: frosted dark (default) or frosted light
  title: z.string().nullable(),
  artist: z.string().nullable(),
  artwork: z.object({ assetId: z.string(), width: z.number(), height: z.number() }).nullable(),
});
export type PlayerSettings = z.infer<typeof PlayerSchema>;

export const ElementSchema = z.object({
  id: z.string(),
  type: z.enum(ELEMENT_TYPES),
  name: z.string(),
  visible: z.boolean(),
  locked: z.boolean().optional(),
  x: z.number(), y: z.number(), w: z.number().min(1), h: z.number().min(1),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
  in: AnimSchema,
  out: AnimSchema,
  // Optional style blocks; which one applies depends on `type`.
  text: TextStyleSchema.optional(),
  content: z.string().optional(), // custom text for type "text"
  timeKind: z.enum(["elapsed", "remaining", "total"]).optional(),
  shadow: z.number().min(0).max(100).optional(), // cover drop shadow
  bar: z.object({ color: hex, trackColor: hex, trackOpacity: z.number().min(0).max(1), rounded: z.boolean() }).optional(),
  ctl: z.object({ color: hex }).optional(),
  vis: z.object({
    style: z.enum(["bars", "mirror", "radial", "line"]),
    bars: z.number().int().min(8).max(64),
    color: hex,
    gap: z.number().min(0).max(0.9),
    rounded: z.boolean(),
    sensitivity: z.number().min(0.3).max(3),
    smoothing: z.number().min(0).max(1),
  }).optional(),
  reactive: z.number().min(0).max(1).optional(), // pulse scale with bass (cover)
  idle: z.enum(["none", "float", "breathe", "sway", "spin"]).optional(), // looping ambient motion
  coverStyle: z.enum(["plain", "vinyl", "polaroid", "disc", "print"]).optional(), // "polaroid" is the original stacked, taped card; "print" its clean replacement
  shape: z.object({
    kind: z.enum(["rect", "ellipse", "ring", "glow"]),
    color: hex, thickness: z.number().min(1).max(80), radius: z.number().min(0).max(400),
  }).optional(),
  player: PlayerSchema.optional(),
  panel: z.object({ fill: hex, fillOpacity: z.number().min(0).max(1), blur: z.number().min(0).max(100), radius: z.number().min(0).max(300), borderOpacity: z.number().min(0).max(1) }).optional(),
});
export type StoryElement = z.infer<typeof ElementSchema>;

export const BackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: hex }),
  z.object({ type: z.literal("gradient"), from: hex, to: hex, angle: z.number(), motion: z.number().min(-90).max(90) }),
  z.object({
    type: z.literal("art"), blur: z.number().min(0).max(120), zoom: z.number().min(1).max(3),
    brightness: z.number().min(0).max(200), saturation: z.number().min(0).max(250),
    overlay: hex, overlayOpacity: z.number().min(0).max(1),
    drift: z.number().min(0).max(1).optional(), // slow push-in over the story
  }),
  z.object({ type: z.literal("photo") }), // draws Project.photo
  z.object({ type: z.literal("aurora"), base: hex, colors: z.array(hex).length(3), speed: z.number().min(0).max(3) }),
]);
export type Background = z.infer<typeof BackgroundSchema>;

export const CoverParamsSchema = z.object({
  zoom: z.number(), offsetX: z.number(), offsetY: z.number(), rotation: z.number(), radius: z.number(),
  brightness: z.number(), contrast: z.number(), saturation: z.number(), blur: z.number(), grain: z.number(),
});

/** The user's own picture behind a Photo Story. Crop is CSS object-position style, so it survives canvas format changes. */
export const PhotoSchema = z.object({
  assetId: z.string(), width: z.number().min(1), height: z.number().min(1),
  zoom: z.number().min(1).max(4),
  focusX: z.number().min(0).max(1), // 0 = left edge of the picture aligned, 1 = right edge
  focusY: z.number().min(0).max(1),
  dim: z.number().min(0).max(0.85), // black overlay opacity
});
export type Photo = z.infer<typeof PhotoSchema>;

export const SnippetSchema = z.object({
  startMs: z.number(), endMs: z.number(), fadeInMs: z.number(), fadeOutMs: z.number(),
  gainDb: z.number(), normalize: z.boolean(),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  track: z.object({
    title: z.string(), artists: z.array(z.string()), album: z.string().nullable(),
    durationMs: z.number().nullable(), platform: z.string(), sourceUrl: z.string(),
  }),
  audio: z.object({
    sourceAssetId: z.string().nullable(),
    sourceDurationMs: z.number().nullable(),
    snippetAssetId: z.string().nullable(),
    snippet: SnippetSchema.nullable(),
  }),
  artwork: z.object({ assetId: z.string(), width: z.number(), height: z.number(), params: CoverParamsSchema }).nullable(),
  theme: z.object({ sync: z.boolean(), background: hex, text: hex, accent: hex }),
  canvas: z.object({ aspect: z.enum(["9:16", "1:1", "4:5", "16:9"]), fps: z.number().int().min(15).max(60) }),
  background: BackgroundSchema,
  effects: z.object({ vignette: z.number().min(0).max(100), grain: z.number().min(0).max(100) }),
  templateId: z.string(),
  templateVersion: z.number().int().min(1).optional(), // absent = design 1 (see TEMPLATE_VERSION)
  typePair: z.string().optional(), // curated typography choice kept across format changes
  photo: PhotoSchema.nullable().optional(),
  elements: z.array(ElementSchema),
  progress: z.object({ mode: z.enum(["snippet", "original"]) }),
  fallbackDurationMs: z.number(), // story length when no audio snippet exists
});
export type Project = z.infer<typeof ProjectSchema>;

/** Migrate stored data of any older version to the current schema; throws if unrecoverable. */
export function parseProject(raw: unknown): Project {
  const data = raw as { schemaVersion?: number };
  // Future: if (data.schemaVersion === 1) data = migrate1to2(data) ...
  if (data?.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported project version ${String(data?.schemaVersion)}`);
  return ProjectSchema.parse(raw);
}

export const templateVersionOf = (p: Pick<Project, "templateVersion">) => p.templateVersion ?? 1;
export const canvasOf = (p: Project) => ASPECTS[p.canvas.aspect];
export const durationMsOf = (p: Project) =>
  p.audio.snippet ? p.audio.snippet.endMs - p.audio.snippet.startMs : p.fallbackDurationMs;
export const durationFramesOf = (p: Project) => Math.max(1, Math.round((durationMsOf(p) / 1000) * p.canvas.fps));
