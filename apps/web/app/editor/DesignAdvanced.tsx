"use client";

import { hueShift } from "@mss/compositions";
import { useEditor } from "@/lib/editor/store";
import { Color, Range, Section, Select } from "./fields";

/** Background, theme colours and effects. Lives under Advanced in Design. */
export default function DesignAdvanced() {
  const p = useEditor((s) => s.project)!;
  const { edit } = useEditor.getState();
  const bg = p.background;
  return (
    <>
      <Section title="Background">
        {bg.type === "photo" ? <p className="py-1 text-xs text-muted">The photo is the background. Crop and dim it under Photo.</p> : <Select label="Type" value={bg.type}
          options={[{ value: "solid", label: "Solid" }, { value: "gradient", label: "Gradient" }, { value: "art", label: "Blurred artwork" }, { value: "aurora", label: "Aurora" }]}
          onChange={(type) => edit((d) => {
            if (type === "solid") d.background = { type, color: p.theme.background };
            else if (type === "gradient") d.background = { type, from: p.theme.background, to: "#000000", angle: 180, motion: 0 };
            else if (type === "aurora") d.background = { type, base: "#0b0b0b", colors: [p.theme.accent, hueShift(p.theme.accent, 38), hueShift(p.theme.accent, -42)], speed: 1 };
            else d.background = { type, blur: 60, zoom: 1.4, brightness: 70, saturation: 130, overlay: "#000000", overlayOpacity: 0.25 };
          })} />}
        {bg.type === "solid" && <Color label="Color" value={bg.color} onChange={(v) => edit((d) => { if (d.background.type === "solid") d.background.color = v; }, "bg:c")} />}
        {bg.type === "gradient" && (
          <>
            <Color label="From" value={bg.from} onChange={(v) => edit((d) => { if (d.background.type === "gradient") d.background.from = v; }, "bg:f")} />
            <Color label="To" value={bg.to} onChange={(v) => edit((d) => { if (d.background.type === "gradient") d.background.to = v; }, "bg:t")} />
            <Range label="Angle" value={bg.angle} min={0} max={360} fmt={(v) => `${v}°`} onChange={(v) => edit((d) => { if (d.background.type === "gradient") d.background.angle = v; }, "bg:a")} />
            <Range label="Drift" value={bg.motion} min={-90} max={90} fmt={(v) => `${v}°/s`} onChange={(v) => edit((d) => { if (d.background.type === "gradient") d.background.motion = v; }, "bg:m")} />
          </>
        )}
        {bg.type === "aurora" && (
          <>
            <Color label="Base" value={bg.base} onChange={(v) => edit((d) => { if (d.background.type === "aurora") d.background.base = v; }, "bg:base")} />
            {bg.colors.map((c, i) => (
              <Color key={i} label={`Light ${i + 1}`} value={c} onChange={(v) => edit((d) => { if (d.background.type === "aurora") d.background.colors[i] = v; }, `bg:l${i}`)} />
            ))}
            <Range label="Speed" value={bg.speed} min={0} max={3} step={0.1} fmt={(v) => `${v.toFixed(1)}×`} onChange={(v) => edit((d) => { if (d.background.type === "aurora") d.background.speed = v; }, "bg:sp")} />
          </>
        )}
        {bg.type === "art" && (
          <>
            <Range label="Push-in" value={bg.drift ?? 0} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((d) => { if (d.background.type === "art") d.background.drift = v; }, "bg:dr")} />
            <Range label="Blur" value={bg.blur} min={0} max={120} onChange={(v) => edit((d) => { if (d.background.type === "art") d.background.blur = v; }, "bg:b")} />
            <Range label="Zoom" value={bg.zoom} min={1} max={3} step={0.05} onChange={(v) => edit((d) => { if (d.background.type === "art") d.background.zoom = v; }, "bg:z")} />
            <Range label="Brightness" value={bg.brightness} min={0} max={200} onChange={(v) => edit((d) => { if (d.background.type === "art") d.background.brightness = v; }, "bg:br")} />
            <Range label="Saturation" value={bg.saturation} min={0} max={250} onChange={(v) => edit((d) => { if (d.background.type === "art") d.background.saturation = v; }, "bg:s")} />
            <Color label="Overlay" value={bg.overlay} onChange={(v) => edit((d) => { if (d.background.type === "art") d.background.overlay = v; }, "bg:o")} />
            <Range label="Overlay opacity" value={bg.overlayOpacity} min={0} max={1} step={0.01} onChange={(v) => edit((d) => { if (d.background.type === "art") d.background.overlayOpacity = v; }, "bg:oo")} />
          </>
        )}
              </Section>
      <Section title="Theme colours">
        {(["background", "text", "accent"] as const).map((k) => (
          <Color key={k} label={k[0].toUpperCase() + k.slice(1)} value={p.theme[k]} onChange={(v) => edit((d) => {
            const old = d.theme[k];
            d.theme[k] = v;
            if (k === "text") for (const e of d.elements) {
              if (e.text?.color === old) e.text.color = v;
              if (e.bar?.color === old) e.bar.color = v;
              if (e.bar?.trackColor === old) e.bar.trackColor = v;
              if (e.ctl?.color === old) e.ctl.color = v;
            }
            if (k === "background") {
              const b = d.background;
              if (b.type === "solid" && b.color === old) b.color = v;
              if (b.type === "gradient" && b.from === old) b.from = v;
              if (b.type === "aurora" && b.base === old) b.base = v;
            }
          }, `theme:${k}`)} />
        ))}
        <p className="mt-1 text-[11px] text-muted">Elements still using the old colour follow along; custom colours stay.</p>
      </Section>
      <Section title="Effects">
        <Range label="Vignette" value={p.effects.vignette} min={0} max={100} onChange={(v) => edit((d) => { d.effects.vignette = v; }, "fx:v")} />
        <Range label="Film grain" value={p.effects.grain} min={0} max={100} onChange={(v) => edit((d) => { d.effects.grain = v; }, "fx:g")} />
      </Section>
    </>
  );
}
