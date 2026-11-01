"use client";

import { useEffect, useRef, useState } from "react";
import { ASPECTS, defaultPhoto, panFocus, photoRect, type Photo } from "@mss/compositions";
import { ApiError, assetUrl, getAsset, uploadPhoto } from "@/lib/api";
import { useEditor } from "@/lib/editor/store";
import { Range, Section } from "./fields";

const MAX_BYTES = 25 * 1024 * 1024;
const FRAME_W = 220;
const btn = "border border-line px-2.5 py-1 text-xs hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] disabled:opacity-40";

/** Photo background of a Photo Story: upload, crop frame (drag to position, zoom), dim, replace and remove. */
export default function PhotoControls() {
  const photo = useEditor((s) => s.project!.photo ?? null);
  const aspect = useEditor((s) => s.project!.canvas.aspect);
  const { w: W, h: H } = ASPECTS[aspect];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingId, setMissingId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // A stored project can point at a photo the server no longer has; say so instead of showing a broken frame.
  const photoId = photo?.assetId;
  useEffect(() => {
    if (!photoId) return;
    let live = true;
    getAsset(photoId).catch((e) => { if (live && e instanceof ApiError && e.code !== "network") setMissingId(photoId); });
    return () => { live = false; };
  }, [photoId]);

  const missing = !!photoId && missingId === photoId;

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name)) { setError("That doesn’t look like a picture. Choose a JPG, PNG or WebP."); return; }
    if (file.size > MAX_BYTES) { setError("That photo is over 25 MB. Choose a smaller one."); return; }
    setBusy(true);
    try {
      const a = await uploadPhoto(file, file.name);
      const st = useEditor.getState();
      const prev = st.project!.photo;
      const next = defaultPhoto(a.id, a.width ?? 1, a.height ?? 1);
      // Replacing keeps the dimming the user chose; the crop restarts because the new picture has other proportions.
      st.setPhoto(prev ? { ...next, dim: prev.dim } : next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t upload that photo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const file = (
    <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose a photo" />
  );

  if (!photo) {
    return (
      <Section title="Photo">
        {file}
        <button className={`${btn} w-full py-6`} disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Choose a photo"}
        </button>
        <p className="mt-2 text-[11px] text-muted">The photo fills the whole story. Phone photos are straightened automatically.</p>
        {error && <p role="alert" className="mt-2 text-xs text-[#d33]">{error}</p>}
      </Section>
    );
  }
  return (
    <Section title="Photo" action={
      <span className="flex gap-3">
        <button className="text-[11px] text-muted underline" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Replace"}</button>
        <button className="text-[11px] text-muted underline" onClick={() => useEditor.getState().removePhoto()}>Remove</button>
      </span>}>
      {file}
      {missing ? (
        <p role="alert" className="mb-2 text-xs text-[#d33]">This photo is no longer on the server, so it can’t be shown or exported. Replace it with the original file.</p>
      ) : (
        <CropFrame key={photo.assetId} photo={photo} W={W} H={H} />
      )}
      <Range label="Zoom" value={photo.zoom} min={1} max={4} step={0.01} fmt={(v) => `${v.toFixed(2)}×`} onChange={(zoom) => useEditor.getState().editPhoto({ zoom }, "photo:zoom")} />
      <Range label="Dim" value={photo.dim} min={0} max={0.85} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(dim) => useEditor.getState().editPhoto({ dim }, "photo:dim")} />
      <button className={`${btn} mt-1`} onClick={() => useEditor.getState().editPhoto({ zoom: 1, focusX: 0.5, focusY: 0.5 }, "photo:reset")}>Reset crop</button>
      {error && <p role="alert" className="mt-2 text-xs text-[#d33]">{error}</p>}
    </Section>
  );
}

function CropFrame({ photo, W, H }: { photo: Photo; W: number; H: number }) {
  const s = Math.min(FRAME_W / W, 260 / H);
  const r = photoRect(photo, W, H);
  const drag = useRef<{ x: number; y: number; photo: Photo } | null>(null);
  const [failed, setFailed] = useState(false);

  const move = (focusX: number, focusY: number) => useEditor.getState().live((d) => { if (d.photo) { d.photo.focusX = focusX; d.photo.focusY = focusY; } });
  function onKey(e: React.KeyboardEvent) {
    const step = (e.shiftKey ? 0.1 : 0.02);
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    const c = (n: number) => Math.min(1, Math.max(0, n));
    useEditor.getState().editPhoto({ focusX: c(photo.focusX + v[0]), focusY: c(photo.focusY + v[1]) }, "photo:nudge");
  }
  return (
    <div className="mb-2 flex justify-center">
      <div
        tabIndex={0} role="slider" aria-label="Photo position. Drag, or use the arrow keys."
        aria-valuetext={`${Math.round(photo.focusX * 100)}% across, ${Math.round(photo.focusY * 100)}% down`}
        aria-valuenow={Math.round(photo.focusX * 100)} aria-valuemin={0} aria-valuemax={100}
        onKeyDown={onKey}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); useEditor.getState().beginGesture(); drag.current = { x: e.clientX, y: e.clientY, photo }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          // panFocus works from where the drag started, so the picture follows the pointer.
          const f = panFocus(d.photo, W, H, (e.clientX - d.x) / s, (e.clientY - d.y) / s);
          move(f.focusX, f.focusY);
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        className="relative cursor-grab touch-none select-none overflow-hidden border border-line bg-black active:cursor-grabbing"
        style={{ width: W * s, height: H * s }}>
        {failed ? (
          <p className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-white">This photo couldn’t be loaded.</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(photo.assetId)} alt="" draggable={false} onError={() => setFailed(true)}
            className="pointer-events-none absolute max-w-none" style={{ left: r.left * s, top: r.top * s, width: r.width * s, height: r.height * s }} />
        )}
        <div className="pointer-events-none absolute inset-0" style={{ background: `rgba(0,0,0,${photo.dim})` }} />
      </div>
    </div>
  );
}
