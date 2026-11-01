"use client";

import type { PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { durationFramesOf, formatClock } from "@mss/compositions";
import { useEditor } from "@/lib/editor/store";
import { saveProject } from "@/lib/editor/persist";
import CanvasStage from "./CanvasStage";
import ClipDialog from "./ClipDialog";
import DesignPanel from "./DesignPanel";
import EditPanel from "./EditPanel";
import ExportDialog from "./ExportDialog";

function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const first = useEditor.getState().project;
    if (first) void saveProject(first).catch(() => undefined); // persist on open so "Continue" works even before any edit
    const unsub = useEditor.subscribe((s, prev) => {
      if (!s.project || s.project === prev.project) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const p = useEditor.getState().project;
        if (!p) return;
        useEditor.getState().setSaveStatus("saving");
        saveProject(p).then(
          () => useEditor.getState().setSaveStatus("saved"),
          () => useEditor.getState().setSaveStatus("error"),
        );
      }, 600);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); st.redo(); return; }
      const id = st.selectedId;
      if (!id) return;
      if (st.project!.elements.find((x) => x.id === id)?.locked && (e.key === "Delete" || e.key === "Backspace")) return;
      const step = e.shiftKey ? 10 : 1;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (d[e.key]) {
        e.preventDefault();
        const [dx, dy] = d[e.key];
        const el = st.project!.elements.find((x) => x.id === id)!;
        if (el.locked) return;
        st.editElement(id, { x: el.x + dx, y: el.y + dy }, `nudge:${id}`);
      } else if (e.key === "Escape") st.select(null);
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); st.remove(id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}


export default function Editor({ onExit }: { onExit: () => void }) {
  const project = useEditor((s) => s.project);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const status = useEditor((s) => s.saveStatus);
  const playerRef = useRef<PlayerRef | null>(null);
  const [showSafe, setShowSafe] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [clipping, setClipping] = useState(false);
  const [tab, setTab] = useState<"design" | "edit">("design");
  useAutosave();
  useShortcuts();

  // Picking something on the canvas (or in a list) is a request to change it, so show its controls.
  useEffect(() => useEditor.subscribe((s, prev) => { if (s.selectedId && s.selectedId !== prev.selectedId) setTab("edit"); }), []);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const on = () => setPlaying(true), off = () => setPlaying(false);
    const fr = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("play", on);
    p.addEventListener("pause", off);
    p.addEventListener("frameupdate", fr);
    return () => { p.removeEventListener("play", on); p.removeEventListener("pause", off); p.removeEventListener("frameupdate", fr); };
  }, [project?.canvas.aspect]);

  if (!project) return null;
  const st = useEditor.getState;
  const btn = "whitespace-nowrap border border-line px-2.5 py-1 text-xs disabled:opacity-35 hover:enabled:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]";
  const openClip = () => { playerRef.current?.pause(); setClipping(true); };

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-[var(--bg)] text-[var(--fg)]">
      <header className="flex items-center gap-2 max-md:[&>button:first-child]:mr-auto border-b border-line px-3 py-2">
        <button className={btn} onClick={onExit}>← Back</button>
        <span className="mx-2 min-w-0 flex-1 truncate text-sm font-medium max-md:hidden">{project.name}</span>
        <button className={btn} disabled={!canUndo} onClick={() => st().undo()} aria-label="Undo">Undo</button>
        <button className={btn} disabled={!canRedo} onClick={() => st().redo()} aria-label="Redo">Redo</button>
        <span className="ml-auto text-xs text-muted max-md:hidden" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Couldn’t save locally" : ""}
        </span>
        <button className={btn} onClick={() => { const p = playerRef.current; if (p) { if (p.isPlaying()) p.pause(); else { p.seekTo(0); p.play(); } } }}>
          {playing ? "Pause" : "Play"}
        </button>
        <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted max-sm:hidden">
          <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} className="accent-[var(--accent)]" /> Safe area
        </label>
        <button className="whitespace-nowrap bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white" onClick={() => { playerRef.current?.pause(); setExporting(true); }}>Export</button>
      </header>
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col max-md:h-[44dvh] max-md:flex-none md:order-2">
          <CanvasStage showSafe={showSafe} playerRef={playerRef} />
          <Scrubber frame={frame} playerRef={playerRef} />
        </div>
        <aside className="flex w-80 shrink-0 flex-col border-line md:order-1 md:border-r max-md:min-h-0 max-md:w-full max-md:flex-1 max-md:border-t">
          <div className="flex border-b border-line" role="tablist" aria-label="Editor panels">
            {(["design", "edit"] as const).map((t) => (
              <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls="side-panel" onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-medium ${tab === t ? "border-b-2 border-[var(--accent)]" : "text-muted"}`}>
                {t === "design" ? "Design" : "Edit"}
              </button>
            ))}
          </div>
          <div id="side-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
            {tab === "design" ? <DesignPanel onClip={openClip} /> : <EditPanel onClip={openClip} />}
          </div>
        </aside>
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {clipping && <ClipDialog onClose={() => setClipping(false)} />}
    </div>
  );
}

function Scrubber({ frame, playerRef }: { frame: number; playerRef: React.RefObject<PlayerRef | null> }) {
  const p = useEditor((s) => s.project)!;
  const total = durationFramesOf(p);
  const t = (f: number) => formatClock((f / p.canvas.fps) * 1000);
  return (
    <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-xs tabular-nums text-muted">
      <span className="w-10">{t(frame)}</span>
      <input type="range" aria-label="Playhead" min={0} max={Math.max(1, total - 1)} value={Math.min(frame, total - 1)}
        onChange={(e) => { const pl = playerRef.current; if (pl) { pl.pause(); pl.seekTo(Number(e.target.value)); } }}
        className="flex-1 accent-[var(--accent)]" />
      <span className="w-10 text-right">{t(total)}</span>
    </div>
  );
}
