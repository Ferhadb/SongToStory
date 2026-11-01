"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, getAsset, type Asset } from "@/lib/api";
import { useEditor } from "@/lib/editor/store";
import SnippetEditor from "../SnippetEditor";

/** Reopens the clip editor for the story's song so the part that plays can change. Applying updates the story in one undo step. */
export default function ClipDialog({ onClose }: { onClose: () => void }) {
  const audio = useEditor((s) => s.project!.audio);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const NO_SOURCE = "The full song isn’t stored for this story, so the clip can’t be changed. Make a new story from the song to pick another part.";
  const error = audio.sourceAssetId ? loadError : NO_SOURCE;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    if (!audio.sourceAssetId) return;
    getAsset(audio.sourceAssetId).then(
      (a) => live && setAsset(a),
      (e) => live && setLoadError(e instanceof ApiError && e.code !== "network"
        ? "The full song is no longer on the server, so the clip can’t be changed. Make a new story from the song to pick another part."
        : e instanceof ApiError ? e.message : "Couldn’t load the song."),
    );
    return () => { live = false; };
  }, [audio.sourceAssetId]);

  return (
    <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/50 p-4" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="clip-title" className="w-full max-w-xl border border-line bg-[var(--bg)] p-4 text-[var(--fg)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="clip-title" className="text-sm font-medium">Change the clip</h2>
          <button ref={closeRef} onClick={onClose} className="border border-line px-2.5 py-1 text-xs">Close</button>
        </div>
        {error && <p role="alert" className="text-xs text-[#d33]">{error}</p>}
        {!asset && !error && <p className="text-xs text-muted">Loading the song…</p>}
        {asset && (
          <SnippetEditor
            asset={asset}
            initial={audio.snippet ?? undefined}
            onReady={(snippetAsset, spec) => { useEditor.getState().setClip(snippetAsset.id, spec); onClose(); }}
          />
        )}
      </div>
    </div>
  );
}
