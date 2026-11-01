"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LYRICS } from "@mss/compositions";
import { ApiError, fetchLyrics } from "@/lib/api";
import { useEditor } from "@/lib/editor/store";
import { Range, Section, Select } from "./fields";

/** Settings for the Lyrics template. Lyrics are looked up on their own whenever the clip changes. */
export default function LyricsControls() {
  const p = useEditor((s) => s.project!);
  const ly = p.lyrics ?? DEFAULT_LYRICS;
  const edit = useEditor.getState().editLyrics;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clip = p.audio.snippet, clipId = p.audio.snippetAssetId;

  const find = useCallback(async () => {
    const pr = useEditor.getState().project!;
    if (!pr.audio.snippet || !pr.audio.snippetAssetId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchLyrics({
        title: pr.track.title, artist: pr.track.artists.join(", "), durationMs: pr.audio.sourceDurationMs,
        startMs: pr.audio.snippet.startMs, endMs: pr.audio.snippet.endMs, snippetAssetId: pr.audio.snippetAssetId,
      });
      if (!r.lines.length) setError("No lyrics found for this clip.");
      else edit({ lines: r.lines });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t get lyrics.");
    } finally {
      setBusy(false);
    }
  }, [edit]);

  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!clipId || ly.lines.length || tried.current === clipId) return;
    tried.current = clipId;
    void find();
  }, [clipId, ly.lines.length, find]);

  return (
    <Section title="Lyrics">
      <p className="mb-2 text-xs text-muted">
        {busy ? "Finding lyrics…" : ly.lines.length ? `${ly.lines.length} lines synced to the clip.` : "No lyrics yet."}
      </p>
      <button onClick={find} disabled={busy || !clip} className="border border-line px-2.5 py-1 text-xs disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]">
        {ly.lines.length ? "Find again" : "Find lyrics"}
      </button>
      {error && <p role="alert" className="mt-1 text-[11px] text-red-500">{error}</p>}
      <Range label="Max size" value={ly.size} min={0.04} max={0.14} step={0.005} fmt={(v) => `${Math.round(v * 1000) / 10}%`} onChange={(v) => edit({ size: v })} />
      <Select label="Align" value={ly.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }]} onChange={(v) => edit({ align: v })} />
      <Select label="Active line" value={ly.highlight} options={[{ value: "accent", label: "Accent colour" }, { value: "text", label: "Text colour" }]} onChange={(v) => edit({ highlight: v })} />
    </Section>
  );
}
