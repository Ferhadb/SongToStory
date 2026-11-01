"use client";

import { useEffect, useState } from "react";
import { createProject, type Project } from "@mss/compositions";
import ArtworkSection, { type CoverSelection } from "./ArtworkSection";
import Editor from "./editor/Editor";
import { useEditor } from "@/lib/editor/store";
import { loadLastProject } from "@/lib/editor/persist";
import { toHex } from "@/lib/artwork";
import type { Snippet } from "@/lib/snippet";
import AudioPicker from "./AudioPicker";
import SnippetEditor from "./SnippetEditor";
import PasteForm from "./PasteForm";
import { PLATFORM_LABEL, type Asset, type ResolveResult } from "@/lib/api";

const YT = new Set(["youtube", "youtube_music"]);

export default function CreateFlow() {
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [cover, setCover] = useState<CoverSelection | null>(null);
  const [snip, setSnip] = useState<{ asset: Asset; spec: Snippet } | null>(null);
  const [editing, setEditing] = useState(false);
  const [last, setLast] = useState<Project | null>(null);

  useEffect(() => {
    let live = true;
    loadLastProject().then((p) => { if (live) setLast(p); });
    return () => { live = false; };
  }, []);

  function openEditor() {
    if (!resolved || !cover || !snip || !asset) return;
    const { track, link } = resolved;
    const th = cover.theme;
    useEditor.getState().load(
      createProject({
        id: crypto.randomUUID(),
        track: {
          title: track.title, artists: track.artists.map((a) => a.name), album: track.album?.name ?? null,
          durationMs: track.duration_ms ?? null, platform: link.platform, sourceUrl: link.canonical_url,
        },
        audio: { sourceAssetId: asset.id, sourceDurationMs: asset.duration_ms, snippetAssetId: snip.asset.id, snippet: snip.spec },
        artwork: { assetId: cover.asset.id, width: cover.asset.width ?? 1200, height: cover.asset.height ?? 1200, params: cover.params },
        theme: th
          ? { background: toHex(th.background), text: toHex(th.text), accent: toHex(th.accent) }
          : { background: "#1a1a1a", text: "#ffffff", accent: "#ff5a36" },
      }),
    );
    setEditing(true);
  }
  function continueLast() {
    if (!last) return;
    useEditor.getState().load(last);
    setEditing(true);
  }

  if (editing) return <Editor onExit={() => setEditing(false)} />;

  if (!resolved) {
    return (
      <div className="flex w-full max-w-xl flex-col items-stretch gap-6">
        <PasteForm onResolved={(r) => { setResolved(r); setAsset(null); setSnip(null); }} />
        {last && (
          <button onClick={continueLast} className="self-center text-sm text-muted underline">
            Continue “{last.name}”
          </button>
        )}
      </div>
    );
  }
  const { track, link, warnings } = resolved;
  const artistText = track.artists.map((a) => a.name).join(", ");
  const field = "block w-full truncate border-b border-transparent bg-transparent py-0.5 outline-none hover:border-line focus:border-fg";
  // Typed artist names feed the YouTube match too, so re-run the search if nothing was picked yet.
  function commitArtists(v: string) {
    const names = v.split(",").map((a) => a.trim()).filter(Boolean);
    if (names.join(", ") === artistText) return;
    setResolved((r) => r && { ...r, track: { ...r.track, artists: names.map((name) => ({ name, role: "primary" })) } });
    if (!asset && !YT.has(link.platform)) setPickerKey((k) => k + 1);
  }

  return (
    <div className="flex w-full max-w-xl flex-col items-stretch gap-8">
      <div className="flex items-center gap-4 border border-line p-3">
        {track.artwork.original && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={track.artwork.original.url} alt="" className="size-16 object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <input aria-label="Title" value={track.title} placeholder="Title" className={`${field} text-base font-medium`}
            onChange={(e) => setResolved({ ...resolved, track: { ...track, title: e.target.value } })} />
          <input aria-label="Artist" key={artistText} defaultValue={artistText} placeholder="Add artist (comma-separated)"
            className={`${field} text-sm text-muted`} onBlur={(e) => commitArtists(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          <p className="text-xs text-muted">{PLATFORM_LABEL[link.platform]}</p>
        </div>
        <button onClick={() => setResolved(null)} className="text-xs text-muted underline">
          Different song
        </button>
      </div>
      {warnings.map((w) => (
        <p key={w} className="-mt-5 text-xs text-muted">{w}</p>
      ))}

      <ArtworkSection track={track} onChange={setCover} />

      {asset ? (
        <SnippetEditor
          key={asset.id}
          asset={asset}
          onChangeAudio={() => { setAsset(null); setSnip(null); setPickerKey((k) => k + 1); }}
          onReady={(a, spec) => setSnip({ asset: a, spec })}
        />
      ) : (
        <AudioPicker
          key={pickerKey}
          track={track}
          youtubeId={pickerKey === 0 && YT.has(link.platform) ? link.external_id : null}
          onPicked={setAsset}
        />
      )}

      {cover && snip && (
        <button onClick={openEditor} className="bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white">
          Design the story →
        </button>
      )}
      {!snip && asset && (
        <p className="text-xs text-muted">Apply the snippet above to continue to the editor.</p>
      )}
    </div>
  );
}
