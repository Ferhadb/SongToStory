"use client";

import { useRef, useState } from "react";
import { PLAYER_STYLES, playerHeight, type PlayerSettings, type StoryElement } from "@mss/compositions";
import { ApiError, uploadImage } from "@/lib/api";
import { useEditor } from "@/lib/editor/store";
import { Range, Row, Section, inputCls } from "./fields";

const STYLE_LABEL: Record<(typeof PLAYER_STYLES)[number], string> = { apple: "Apple Music", "apple-tall": "Apple Music, large", spotify: "Spotify" };
const small = "text-[11px] text-muted underline";

/** The player card over a Photo Story: look, text, artwork, size and which part of the song plays. */
export default function PlayerControls({ el, onClip }: { el: StoryElement & { player: PlayerSettings }; onClip: () => void }) {
  const track = useEditor((s) => s.project!.track);
  const clip = useEditor((s) => s.project!.audio.snippet);
  const pl = el.player;
  const edit = (patch: Partial<PlayerSettings>, key?: string) => useEditor.getState().editPlayer(el.id, patch, key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function pickArtwork(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const a = await uploadImage(f, f.name);
      edit({ artwork: { assetId: a.id, width: a.width ?? 1, height: a.height ?? 1 } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t upload that image.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  const secs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <>
      <Section title="Player card">
        <div role="radiogroup" aria-label="Player style" className="mb-2 grid grid-cols-3 gap-1.5">
          {PLAYER_STYLES.map((s) => (
            <button key={s} role="radio" aria-checked={pl.style === s} onClick={() => edit({ style: s })}
              className={`border px-2 py-2 text-xs ${pl.style === s ? "border-[var(--accent)]" : "border-line"}`}>{STYLE_LABEL[s]}</button>
          ))}
        </div>
        {pl.style !== "spotify" && (
          <div role="radiogroup" aria-label="Card colour" className="mb-2 grid grid-cols-2 gap-1.5">
            {(["dark", "light"] as const).map((t) => (
              <button key={t} role="radio" aria-checked={(pl.tone ?? "dark") === t} onClick={() => edit({ tone: t })}
                className={`border px-2 py-1.5 text-xs ${(pl.tone ?? "dark") === t ? "border-[var(--accent)]" : "border-line"}`}>{t === "dark" ? "Dark glass" : "Light glass"}</button>
            ))}
          </div>
        )}
        <Range label="Size" value={el.w} min={320} max={1400} step={10} fmt={(v) => `${Math.round(v)} px wide`}
          onChange={(w) => useEditor.getState().editElement(el.id, { w, h: playerHeight(pl.style, w) }, `${el.id}:size`)} />
      </Section>
      <Section title="Song on the card" action={(pl.title !== null || pl.artist !== null) && <button className={small} onClick={() => edit({ title: null, artist: null })}>Use track details</button>}>
        <Row label="Title"><input value={pl.title ?? track.title} onChange={(e) => edit({ title: e.target.value }, "player:title")} className={inputCls} /></Row>
        <Row label="Artist"><input value={pl.artist ?? track.artists.join(", ")} onChange={(e) => edit({ artist: e.target.value }, "player:artist")} className={inputCls} /></Row>
        <div className="flex items-center justify-between py-1 text-xs">
          <span className="text-muted">Artwork</span>
          <span className="flex gap-3">
            <input ref={file} type="file" accept="image/*" hidden aria-label="Choose artwork" onChange={(e) => pickArtwork(e.target.files?.[0])} />
            <button className={small} disabled={busy} onClick={() => file.current?.click()}>{busy ? "Uploading…" : pl.artwork ? "Replace" : "Choose image"}</button>
            {pl.artwork && <button className={small} onClick={() => edit({ artwork: null })}>Use track cover</button>}
          </span>
        </div>
        {error && <p role="alert" className="text-xs text-[#d33]">{error}</p>}
      </Section>
      <Section title="Music clip">
        <p className="mb-2 text-xs text-muted">
          {clip ? <>Playing {secs(clip.startMs)}–{secs(clip.endMs)} of the song. </> : "No clip chosen yet. "}
          The card’s progress follows the clip in the exported video.
        </p>
        <button onClick={onClip} className="border border-line px-2.5 py-1 text-xs hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]">Change clip…</button>
      </Section>
    </>
  );
}
