"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASPECTS, Story, durationFramesOf, resizeRect, safeArea, snapMove,
  type Guide, type Handle, type Rect, type StoryElement,
} from "@mss/compositions";
import { useEditor } from "@/lib/editor/store";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const POS: Record<Handle, React.CSSProperties> = {
  nw: { left: 0, top: 0, cursor: "nwse-resize" }, n: { left: "50%", top: 0, cursor: "ns-resize" },
  ne: { left: "100%", top: 0, cursor: "nesw-resize" }, e: { left: "100%", top: "50%", cursor: "ew-resize" },
  se: { left: "100%", top: "100%", cursor: "nwse-resize" }, s: { left: "50%", top: "100%", cursor: "ns-resize" },
  sw: { left: 0, top: "100%", cursor: "nesw-resize" }, w: { left: 0, top: "50%", cursor: "ew-resize" },
};

type Drag =
  | { kind: "move"; id: string; sx: number; sy: number; start: Rect }
  | { kind: "resize"; id: string; handle: Handle; sx: number; sy: number; start: Rect; lock: boolean };

export default function CanvasStage({ showSafe, playerRef }: { showSafe: boolean; playerRef: React.RefObject<PlayerRef | null> }) {
  const project = useEditor((s) => s.project)!;
  const selectedId = useEditor((s) => s.selectedId);
  const { w: W, h: H } = ASPECTS[project.canvas.aspect];
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [guides, setGuides] = useState<Guide[]>([]);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.05, Math.min((r.width - 32) / W, (r.height - 32) / H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  const others = useCallback(
    (id: string): Rect[] => useEditor.getState().project!.elements.filter((e) => e.id !== id && e.visible).map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h })),
    [],
  );

  function onMove(ev: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (ev.clientX - d.sx) / scale, dy = (ev.clientY - d.sy) / scale;
    const st = useEditor.getState();
    if (d.kind === "move") {
      let r: Rect = { ...d.start, x: d.start.x + dx, y: d.start.y + dy };
      let g: Guide[] = [];
      if (!ev.altKey) ({ rect: r, guides: g } = snapMove(r, others(d.id), { w: W, h: H }, 8 / scale));
      setGuides(g);
      st.live((p) => { const e = p.elements.find((x) => x.id === d.id); if (e) { e.x = Math.round(r.x); e.y = Math.round(r.y); } });
    } else {
      const r = resizeRect(d.start, d.handle, dx, dy, d.lock || ev.shiftKey);
      st.live((p) => { const e = p.elements.find((x) => x.id === d.id); if (e) { e.x = Math.round(r.x); e.y = Math.round(r.y); e.w = Math.round(r.w); e.h = Math.round(r.h); } });
    }
  }
  function onUp() {
    drag.current = null;
    setGuides([]);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }
  function begin(ev: React.PointerEvent, e: StoryElement, d: { kind: "move" } | { kind: "resize"; handle: Handle; lock: boolean }) {
    ev.stopPropagation();
    ev.preventDefault();
    useEditor.getState().select(e.id);
    if (e.locked) return;
    useEditor.getState().beginGesture();
    drag.current = { ...d, id: e.id, sx: ev.clientX, sy: ev.clientY, start: { x: e.x, y: e.y, w: e.w, h: e.h } } as Drag;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const sa = safeArea(project.canvas.aspect);
  return (
    <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[color-mix(in_srgb,var(--fg)_6%,var(--bg))]"
      onPointerDown={() => useEditor.getState().select(null)}>
      <div className="relative shrink-0 shadow-lg" style={{ width: W * scale, height: H * scale }}>
        <Player
          ref={playerRef}
          component={Story}
          inputProps={{ project, assetBase: "/api/v1/assets" }}
          durationInFrames={durationFramesOf(project)}
          fps={project.canvas.fps}
          compositionWidth={W}
          compositionHeight={H}
          style={{ width: W * scale, height: H * scale }}
          loop
          initialFrame={Math.min(durationFramesOf(project) - 1, Math.round(project.canvas.fps * 2))}
          clickToPlay={false}
          acknowledgeRemotionLicense
        />
        <div className="absolute inset-0">
          {showSafe && (
            <div className="pointer-events-none absolute border border-dashed border-[#ff5a5a]"
              style={{ left: sa.side * scale, right: sa.side * scale, top: sa.top * scale, bottom: sa.bottom * scale }} />
          )}
          {project.elements.map((e) => {
            const sel = e.id === selectedId;
            return (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                aria-label={`${e.name}${e.locked ? " (locked)" : ""}${sel ? " (selected)" : ""}`}
                onFocus={() => useEditor.getState().select(e.id)}
                onPointerDown={(ev) => begin(ev, e, { kind: "move" })}
                className={`absolute ${e.visible ? "cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" : "pointer-events-none"} ${sel ? "outline outline-2 outline-[var(--accent)]" : "hover:outline hover:outline-1 hover:outline-[var(--accent)]"}`}
                style={{ left: e.x * scale, top: e.y * scale, width: e.w * scale, height: e.h * scale, transform: `rotate(${e.rotation}deg)` }}
              >
                {sel && !e.locked && HANDLES.map((h) => (
                  <span key={h} onPointerDown={(ev) => begin(ev, e, { kind: "resize", handle: h, lock: e.type === "cover" || e.type === "player" })}
                    className="absolute size-3 -translate-x-1/2 -translate-y-1/2 border border-[var(--accent)] bg-white"
                    style={POS[h]} />
                ))}
              </div>
            );
          })}
          {guides.map((g, i) => (
            <div key={i} className="pointer-events-none absolute bg-[#ff3df0]"
              style={g.axis === "x" ? { left: g.pos * scale, top: 0, bottom: 0, width: 1 } : { top: g.pos * scale, left: 0, right: 0, height: 1 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
