"use client";

import {
  ASPECTS, DEFAULT_COVER, FONTS, LATIN_ONLY_FONTS, NO_ANIM, playerHeight, safeArea,
  resetElement,
  type Anim, type StoryElement,
} from "@mss/compositions";
import { useEditor } from "@/lib/editor/store";
import PlayerControls from "./PlayerControls";
import TrackFields from "./TrackFields";
import { Advanced, Check, Color, Num, Range, Row, Section, Select, inputCls } from "./fields";

const ANIMS = ["none", "fade", "slide-up", "slide-down", "scale", "blur"].map((v) => ({ value: v as Anim["type"], label: v }));
const EASES = ["linear", "ease-out", "ease-in-out"].map((v) => ({ value: v as Anim["easing"], label: v }));
const chip = "border border-line px-2 py-0.5 hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]";

function alignTo(el: StoryElement, how: "h" | "v" | "left" | "right") {
  const st = useEditor.getState();
  const p = st.project!;
  const { w: W, h: H } = ASPECTS[p.canvas.aspect];
  const sa = safeArea(p.canvas.aspect);
  const patch = how === "h" ? { x: Math.round((W - el.w) / 2) } : how === "v" ? { y: Math.round((H - el.h) / 2) }
    : how === "left" ? { x: Math.round(sa.side) } : { x: Math.round(W - sa.side - el.w) };
  st.editElement(el.id, patch);
}


function CoverProps() {
  const aw = useEditor((s) => s.project!.artwork);
  if (!aw) return null;
  const c = aw.params;
  const set = (k: keyof typeof c, key: string) => (v: number) => useEditor.getState().edit((d) => { if (d.artwork) d.artwork.params[k] = v; }, `cover:${key}`);
  return (
    <Section title="Cover" action={<button className="text-[11px] text-muted underline" onClick={() => useEditor.getState().edit((d) => { if (d.artwork) d.artwork.params = { ...DEFAULT_COVER }; })}>Reset</button>}>
      <Range label="Corner radius" value={c.radius} min={0} max={50} onChange={set("radius", "r")} />
      <Range label="Zoom" value={c.zoom} min={1} max={4} step={0.05} onChange={set("zoom", "z")} />
      <Range label="Pan X" value={c.offsetX} min={-1} max={1} step={0.01} onChange={set("offsetX", "ox")} />
      <Range label="Pan Y" value={c.offsetY} min={-1} max={1} step={0.01} onChange={set("offsetY", "oy")} />
      <Range label="Brightness" value={c.brightness} min={50} max={150} onChange={set("brightness", "b")} />
      <Range label="Contrast" value={c.contrast} min={50} max={150} onChange={set("contrast", "c")} />
      <Range label="Saturation" value={c.saturation} min={0} max={200} onChange={set("saturation", "s")} />
      <Range label="Blur" value={c.blur} min={0} max={40} onChange={set("blur", "bl")} />
      <Range label="Grain" value={c.grain} min={0} max={100} onChange={set("grain", "g")} />
    </Section>
  );
}


/** Controls for the selected item: the few that matter first, everything else under Advanced. */
export default function EditPanel({ onClip }: { onClip: () => void }) {
  const p = useEditor((s) => s.project)!;
  const selectedId = useEditor((s) => s.selectedId);
  const el = p.elements.find((e) => e.id === selectedId) ?? null;
  if (el) return <ElementProps key={el.id} el={el} onClip={onClip} />;
  return (
    <>
      <p className="px-4 py-3 text-xs text-muted">Select something on the canvas, or pick it from the list, to change it here.</p>
      <Section title="Elements" action={<span className="flex gap-3"><button className="text-[11px] text-muted underline" onClick={() => useEditor.getState().addText()}>+ Text</button><button className="text-[11px] text-muted underline" onClick={() => useEditor.getState().addVisualizer()}>+ Visualizer</button></span>}>
        <ul>
          {p.elements.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1 text-xs">
              <input type="checkbox" checked={e.visible} aria-label={`Show ${e.name}`}
                onChange={(ev) => useEditor.getState().editElement(e.id, { visible: ev.target.checked })} className="accent-[var(--accent)]" />
              <button className="flex-1 truncate text-left" onClick={() => useEditor.getState().select(e.id)}>{e.name}</button>
              <span className="text-[10px] text-muted">{e.type}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function ElementProps({ el, onClip }: { el: StoryElement; onClip: () => void }) {
  const set = (patch: Partial<StoryElement>, key?: string) => useEditor.getState().editElement(el.id, patch, key);
  const t = el.text;
  const setText = (patch: Partial<NonNullable<StoryElement["text"]>>, key: string) => set({ text: { ...t!, ...patch } }, `${el.id}:text:${key}`);
  const isTrackText = el.type === "title" || el.type === "artist" || el.type === "album";
  const setSize = (patch: { w?: number; h?: number }) => {
    // The player card only scales as a whole; its height follows the width.
    if (el.type === "player" && el.player && patch.w !== undefined) set({ w: Math.max(1, patch.w), h: playerHeight(el.player.style, Math.max(1, patch.w)) });
    else set({ w: Math.max(1, patch.w ?? el.w), h: Math.max(1, patch.h ?? el.h) });
  };
  return (
    <>
      <Section title={el.name} action={
        <button className="text-[11px] text-muted underline" onClick={() => useEditor.getState().replace(resetElement(useEditor.getState().project!, el.id))}>Reset</button>}>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {([["Forward", () => useEditor.getState().reorder(el.id, 1)], ["Back", () => useEditor.getState().reorder(el.id, -1)], ["Duplicate", () => useEditor.getState().duplicate(el.id)], ["Delete", () => useEditor.getState().remove(el.id)], ["Done", () => useEditor.getState().select(null)]] as const).map(([l, f]) => (
            <button key={l} onClick={f} className={chip}>{l}</button>
          ))}
        </div>
      </Section>

      {el.type === "player" && el.player && <PlayerControls el={{ ...el, player: el.player }} onClip={onClip} />}

      {isTrackText && <Section title="Song details"><TrackFields only={el.type as "title" | "artist" | "album"} /></Section>}
      {el.type === "text" && (
        <Section title="Text">
          <Row label="Content"><input value={el.content ?? ""} onChange={(e) => set({ content: e.target.value }, `${el.id}:content`)} className={inputCls} /></Row>
        </Section>
      )}
      {t && (
        <Section title="Look">
          <Range label="Size" value={t.fontSize} min={12} max={240} onChange={(fontSize) => setText({ fontSize }, "fs")} />
          <Color label="Colour" value={t.color} onChange={(color) => setText({ color }, "c")} />
          <Select label="Align" value={t.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} onChange={(align) => setText({ align }, "al")} />
        </Section>
      )}
      {el.type === "cover" && (
        <Section title="Cover style">
          <Select label="Frame" value={el.coverStyle ?? "plain"} options={[
            { value: "plain", label: "Plain" }, { value: "disc", label: "Spinning disc" }, { value: "vinyl", label: "Vinyl sleeve" }, { value: "print", label: "Instant print" },
            ...(el.coverStyle === "polaroid" ? [{ value: "polaroid" as const, label: "Stacked Polaroid (earlier)" }] : []),
          ]} onChange={(coverStyle) => set({ coverStyle })} />
        </Section>
      )}
      {el.type === "shape" && el.shape && (() => {
        const sh = el.shape;
        const setShape = (patch: Partial<typeof sh>, key: string) => set({ shape: { ...sh, ...patch } }, `${el.id}:shape:${key}`);
        return (
          <Section title="Shape">
            <Select label="Kind" value={sh.kind} options={[{ value: "rect", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" }, { value: "ring", label: "Ring" }, { value: "glow", label: "Glow" }]} onChange={(kind) => setShape({ kind }, "kind")} />
            <Color label="Colour" value={sh.color} onChange={(color) => setShape({ color }, "color")} />
            {sh.kind === "ring" && <Range label="Thickness" value={sh.thickness} min={1} max={80} onChange={(thickness) => setShape({ thickness }, "th")} />}
            {sh.kind === "rect" && <Range label="Corner radius" value={sh.radius} min={0} max={400} onChange={(radius) => setShape({ radius }, "r")} />}
          </Section>
        );
      })()}
      {el.type === "visualizer" && el.vis && (() => {
        const v = el.vis;
        const setVis = (patch: Partial<typeof v>, key: string) => set({ vis: { ...v, ...patch } }, `${el.id}:vis:${key}`);
        return (
          <Section title="Visualizer">
            <Select label="Style" value={v.style} options={[{ value: "bars", label: "Bars" }, { value: "mirror", label: "Mirrored bars" }, { value: "radial", label: "Radial" }, { value: "line", label: "Line" }]} onChange={(style) => setVis({ style }, "style")} />
            <Color label="Colour" value={v.color} onChange={(color) => setVis({ color }, "color")} />
            <Range label="Sensitivity" value={v.sensitivity} min={0.3} max={3} step={0.1} fmt={(x) => `${x.toFixed(1)}×`} onChange={(sensitivity) => setVis({ sensitivity }, "sens")} />
          </Section>
        );
      })()}

      <Advanced title="Advanced: position and motion">
        {el.type === "cover" && <CoverProps />}
        <Section title="Position and size">
          <div className="grid grid-cols-2 gap-x-4">
            <Num label="X" value={el.x} onChange={(x) => set({ x })} />
            <Num label="Y" value={el.y} onChange={(y) => set({ y })} />
            <Num label="W" value={el.w} onChange={(w) => setSize({ w })} />
            {el.type === "player" ? <Row label="H"><span className="text-xs tabular-nums text-muted">{Math.round(el.h)} (follows W)</span></Row> : <Num label="H" value={el.h} onChange={(h) => setSize({ h })} />}
          </div>
          <div className="mb-1 flex flex-wrap gap-1.5 text-[11px]">
            <button className={chip} onClick={() => alignTo(el, "h")}>Centre H</button>
            <button className={chip} onClick={() => alignTo(el, "v")}>Centre V</button>
            <button className={chip} onClick={() => alignTo(el, "left")}>Left</button>
            <button className={chip} onClick={() => alignTo(el, "right")}>Right</button>
          </div>
          <Check label="Lock position" value={!!el.locked} onChange={(locked) => set({ locked })} />
          <Range label="Rotation" value={el.rotation} min={-180} max={180} fmt={(v) => `${v}°`} onChange={(rotation) => set({ rotation }, `${el.id}:rot`)} />
          <Range label="Opacity" value={el.opacity} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => set({ opacity }, `${el.id}:op`)} />
          {el.type === "cover" && el.shadow !== undefined && (
            <Range label="Shadow" value={el.shadow} min={0} max={100} onChange={(shadow) => set({ shadow }, `${el.id}:shadow`)} />
          )}
        </Section>
        {el.type !== "panel" && el.type !== "player" && (
          <Section title="Idle motion">
            <Select label="Loop" value={el.idle ?? "none"} options={[{ value: "none", label: "None" }, { value: "float", label: "Float" }, { value: "breathe", label: "Breathe" }, { value: "sway", label: "Sway" }, { value: "spin", label: "Spin" }]} onChange={(idle) => set({ idle })} />
          </Section>
        )}
        {el.type === "cover" && (
          <Section title="Audio reaction">
            <Range label="Pulse with bass" value={el.reactive ?? 0} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(reactive) => set({ reactive }, `${el.id}:react`)} />
          </Section>
        )}
        {el.type === "visualizer" && el.vis && (() => {
          const v = el.vis;
          const setVis = (patch: Partial<typeof v>, key: string) => set({ vis: { ...v, ...patch } }, `${el.id}:vis:${key}`);
          return (
            <Section title="Visualizer detail">
              <Range label="Bars" value={v.bars} min={8} max={64} onChange={(bars) => setVis({ bars }, "bars")} />
              <Range label="Gap" value={v.gap} min={0} max={0.9} step={0.05} fmt={(x) => `${Math.round(x * 100)}%`} onChange={(gap) => setVis({ gap }, "gap")} />
              <Range label="Smoothing" value={v.smoothing} min={0} max={1} step={0.05} fmt={(x) => `${Math.round(x * 100)}%`} onChange={(smoothing) => setVis({ smoothing }, "smooth")} />
              <Check label="Rounded" value={v.rounded} onChange={(rounded) => setVis({ rounded }, "round")} />
            </Section>
          );
        })()}
        {t && (
          <Section title="Text detail">
            <Select label="Font" value={t.fontFamily} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(fontFamily) => setText({ fontFamily }, "ff")} />
            {LATIN_ONLY_FONTS.includes(t.fontFamily) && <p className="text-[11px] text-muted">This font has no Cyrillic — those letters will fall back to Inter.</p>}
            <Range label="Weight" value={t.fontWeight} min={300} max={900} step={100} onChange={(fontWeight) => setText({ fontWeight }, "fw")} />
            <Range label="Letter spacing" value={t.letterSpacing} min={-10} max={30} onChange={(letterSpacing) => setText({ letterSpacing }, "ls")} />
            <Range label="Line height" value={t.lineHeight} min={0.8} max={2} step={0.05} onChange={(lineHeight) => setText({ lineHeight }, "lh")} />
            <Check label="Outline only" value={!!t.outline} onChange={(outline) => setText({ outline }, "ol")} />
            <Range label="Scroll" value={t.scroll ?? 0} min={-600} max={600} step={10} fmt={(v) => (v === 0 ? "off" : `${v} px/s`)} onChange={(scroll) => setText({ scroll }, "sc")} />
            <Range label="Max lines" value={t.maxLines} min={1} max={6} onChange={(maxLines) => setText({ maxLines }, "ml")} />
            <Check label="Even line lengths" value={!!t.balance} onChange={(balance) => setText({ balance }, "bal")} />
            <Check label="Uppercase" value={t.uppercase} onChange={(uppercase) => setText({ uppercase }, "up")} />
            <Check label="Shadow" value={t.shadow} onChange={(shadow) => setText({ shadow }, "sh")} />
          </Section>
        )}
        {el.bar && (
          <Section title="Bar">
            <Color label="Fill" value={el.bar.color} onChange={(color) => set({ bar: { ...el.bar!, color } }, `${el.id}:bc`)} />
            <Color label="Track" value={el.bar.trackColor} onChange={(trackColor) => set({ bar: { ...el.bar!, trackColor } }, `${el.id}:bt`)} />
            <Check label="Rounded" value={el.bar.rounded} onChange={(rounded) => set({ bar: { ...el.bar!, rounded } })} />
          </Section>
        )}
        {el.ctl && (
          <Section title="Controls"><Color label="Color" value={el.ctl.color} onChange={(color) => set({ ctl: { color } }, `${el.id}:cc`)} /></Section>
        )}
        <AnimEditor title="Entrance" el={el} which="in" />
        <AnimEditor title="Exit" el={el} which="out" />
      </Advanced>
    </>
  );
}

function AnimEditor({ title, el, which }: { title: string; el: StoryElement; which: "in" | "out" }) {
  const a = el[which] ?? NO_ANIM;
  const set = (patch: Partial<Anim>, key: string) => useEditor.getState().editElement(el.id, { [which]: { ...a, ...patch } }, `${el.id}:${which}:${key}`);
  return (
    <Section title={title}>
      <Select label="Type" value={a.type} options={ANIMS} onChange={(type) => set({ type }, "t")} />
      {a.type !== "none" && (
        <>
          <Range label={which === "in" ? "Delay" : "Ends before end"} value={a.startMs} min={0} max={5000} step={50} fmt={(v) => `${(v / 1000).toFixed(2)}s`} onChange={(startMs) => set({ startMs }, "s")} />
          <Range label="Duration" value={a.durationMs} min={0} max={3000} step={50} fmt={(v) => `${(v / 1000).toFixed(2)}s`} onChange={(durationMs) => set({ durationMs }, "d")} />
          <Range label="Intensity" value={a.intensity} min={0} max={3} step={0.1} onChange={(intensity) => set({ intensity }, "i")} />
          <Select label="Easing" value={a.easing} options={EASES} onChange={(easing) => set({ easing }, "e")} />
        </>
      )}
    </Section>
  );
}