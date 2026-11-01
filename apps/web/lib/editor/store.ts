import { produce, type Draft } from "immer";
import { create } from "zustand";
import {
  ASPECTS, DEFAULT_VIS, PLAYER_RATIO, applyTemplate, changeAspect, playerHeight, reflowTrackText, setTypePair,
  type AspectId, type Photo, type PlayerSettings, type Project, type StoryElement,
} from "@mss/compositions";
import type { Snippet } from "../snippet";

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface EditorState {
  project: Project | null;
  selectedId: string | null;
  past: Project[];
  future: Project[];
  saveStatus: SaveStatus;
  lastKey: string | null;
  lastAt: number;

  load: (p: Project) => void;
  select: (id: string | null) => void;
  /** Edit with history. Edits sharing `key` within 800ms collapse into one undo step. */
  edit: (fn: (d: Draft<Project>) => void, key?: string) => void;
  /** Start of a drag/resize gesture: one checkpoint, then use `live` for each move. */
  beginGesture: () => void;
  live: (fn: (d: Draft<Project>) => void) => void;
  editElement: (id: string, patch: Partial<StoryElement>, key?: string) => void;
  replace: (p: Project, key?: string) => void;
  addText: () => void;
  addVisualizer: () => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  reorder: (id: string, dir: 1 | -1) => void;
  /** Design actions. Each is one undo step. */
  chooseTemplate: (id: string) => void;
  chooseAspect: (a: AspectId) => void;
  chooseTypePair: (id: string | undefined) => void;
  /** Title / artist / album edits; the untouched title block refits to the new text. */
  editTrack: (patch: Partial<Project["track"]>, key?: string) => void;
  /** Photo Story. */
  setPhoto: (photo: Photo) => void;
  editPhoto: (patch: Partial<Photo>, key?: string) => void;
  removePhoto: () => void;
  editPlayer: (id: string, patch: Partial<PlayerSettings>, key?: string) => void;
  /** A new clip of the song (from the clip editor): one undo step, the card's progress follows the new length. */
  setClip: (snippetAssetId: string, snippet: Snippet) => void;
  undo: () => void;
  redo: () => void;
  setSaveStatus: (s: SaveStatus) => void;
}

const stamp = (p: Project): Project => ({ ...p, updatedAt: new Date().toISOString() });

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selectedId: null,
  past: [],
  future: [],
  saveStatus: "idle",
  lastKey: null,
  lastAt: 0,

  load: (p) => set({ project: p, selectedId: null, past: [], future: [], lastKey: null, saveStatus: "idle" }),
  select: (id) => set({ selectedId: id }),

  replace: (p, key) => {
    const { project, past, lastKey, lastAt } = get();
    if (!project) return;
    const now = Date.now();
    const coalesce = key !== undefined && key === lastKey && now - lastAt < COALESCE_MS;
    set({
      project: stamp(p),
      past: coalesce ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: key ?? null,
      lastAt: now,
    });
  },

  edit: (fn, key) => {
    const { project } = get();
    if (!project) return;
    const next = produce(project, fn);
    if (next !== project) get().replace(next, key);
  },

  beginGesture: () => {
    const { project, past } = get();
    if (!project) return;
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [], lastKey: null });
  },

  live: (fn) => {
    const { project } = get();
    if (project) set({ project: stamp(produce(project, fn)) });
  },

  editElement: (id, patch, key) =>
    get().edit((d) => {
      const e = d.elements.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
    }, key ?? `el:${id}:${Object.keys(patch).join(",")}`),

  addText: () => {
    const p = get().project;
    if (!p) return;
    const id = `text-${crypto.randomUUID().slice(0, 8)}`;
    get().edit((d) => {
      d.elements.push({
        id, type: "text", name: "Text", visible: true, x: 72, y: 200, w: 600, h: 100, rotation: 0, opacity: 1,
        in: { type: "fade", startMs: 0, durationMs: 600, easing: "ease-out", intensity: 1 },
        out: { type: "none", startMs: 0, durationMs: 600, easing: "ease-out", intensity: 1 },
        content: "Your text",
        text: { fontFamily: "Inter", fontSize: 56, fontWeight: 600, letterSpacing: 0, lineHeight: 1.15, color: d.theme.text, align: "left", maxLines: 2, shadow: false, uppercase: false },
      });
    });
    set({ selectedId: id });
  },
  addVisualizer: () => {
    const p = get().project;
    if (!p) return;
    const id = `visualizer-${crypto.randomUUID().slice(0, 8)}`;
    get().edit((d) => {
      d.elements.push({
        id, type: "visualizer", name: "Visualizer", visible: true, x: 72, y: 1200, w: 936, h: 240, rotation: 0, opacity: 1,
        in: { type: "fade", startMs: 0, durationMs: 600, easing: "ease-out", intensity: 1 },
        out: { type: "none", startMs: 0, durationMs: 600, easing: "ease-out", intensity: 1 },
        vis: { ...DEFAULT_VIS, color: d.theme.accent },
      });
    });
    set({ selectedId: id });
  },
  duplicate: (id) => {
    const nid = `dup-${crypto.randomUUID().slice(0, 8)}`;
    get().edit((d) => {
      const i = d.elements.findIndex((e) => e.id === id);
      if (i < 0) return;
      const copy = JSON.parse(JSON.stringify(d.elements[i])) as StoryElement;
      copy.id = nid; copy.name = `${copy.name} copy`; copy.x += 30; copy.y += 30;
      d.elements.splice(i + 1, 0, copy);
    });
    set({ selectedId: nid });
  },
  remove: (id) => {
    get().edit((d) => { d.elements = d.elements.filter((e) => e.id !== id); });
    set({ selectedId: null });
  },
  reorder: (id, dir) =>
    get().edit((d) => {
      const i = d.elements.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.elements.length) return;
      [d.elements[i], d.elements[j]] = [d.elements[j], d.elements[i]];
    }),

  chooseTemplate: (id) => {
    const p = get().project;
    if (p) get().replace(applyTemplate(p, id));
    set({ selectedId: null });
  },
  chooseAspect: (a) => {
    const p = get().project;
    if (p && a !== p.canvas.aspect) get().replace(changeAspect(p, a));
    set({ selectedId: null });
  },
  chooseTypePair: (id) => {
    const p = get().project;
    if (p) get().replace(setTypePair(p, id));
  },
  editTrack: (patch, key) => {
    const p = get().project;
    if (!p) return;
    const next = { ...p, track: { ...p.track, ...patch } };
    get().replace(reflowTrackText(p, next), key ?? `track:${Object.keys(patch).join(",")}`);
  },

  setPhoto: (photo) => get().edit((d) => { d.photo = photo; }),
  editPhoto: (patch, key) =>
    get().edit((d) => { if (d.photo) Object.assign(d.photo, patch); }, key ?? `photo:${Object.keys(patch).join(",")}`),
  removePhoto: () => get().edit((d) => { d.photo = null; }),
  editPlayer: (id, patch, key) =>
    get().edit((d) => {
      const e = d.elements.find((x) => x.id === id);
      if (!e?.player) return;
      const styleChanged = patch.style !== undefined && patch.style !== e.player.style;
      Object.assign(e.player, patch);
      if (styleChanged) {
        // The designs have different proportions; the tall card shrinks until it fits on the canvas and stays inside it.
        const { w: W, h: H } = ASPECTS[d.canvas.aspect];
        e.w = Math.min(e.w, Math.floor((H * 0.84) / PLAYER_RATIO[e.player.style]), Math.floor(W * 0.94));
        e.h = playerHeight(e.player.style, e.w);
        e.x = Math.round(Math.min(Math.max(0, e.x), W - e.w));
        e.y = Math.round(Math.min(Math.max(0, e.y), H - e.h));
      }
    }, key ?? `player:${id}:${Object.keys(patch).join(",")}`),
  setClip: (snippetAssetId, snippet) =>
    get().edit((d) => { d.audio.snippetAssetId = snippetAssetId; d.audio.snippet = snippet; }),

  undo: () => {
    const { project, past, future } = get();
    if (!project || !past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], lastKey: null });
  },
  redo: () => {
    const { project, past, future } = get();
    if (!project || !future.length) return;
    set({ project: future[0], past: [...past, project], future: future.slice(1), lastKey: null });
  },
  setSaveStatus: (saveStatus) => set({ saveStatus }),
}));
