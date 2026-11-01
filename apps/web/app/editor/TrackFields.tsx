"use client";

import { useEditor } from "@/lib/editor/store";
import { Row, inputCls } from "./fields";

/** Title, artist and album. Metadata the source didn't supply (Spotify gives no artist keyless) can be typed in here. */
export default function TrackFields({ only }: { only?: "title" | "artist" | "album" }) {
  const track = useEditor((s) => s.project!.track);
  const editTrack = useEditor.getState().editTrack;
  const artists = track.artists.join(", ");
  const show = (k: "title" | "artist" | "album") => !only || only === k;
  const commitArtists = (v: string) => {
    const next = v.split(",").map((a) => a.trim()).filter(Boolean);
    if (next.join(", ") !== artists) editTrack({ artists: next }, "track:artists");
  };
  return (
    <>
      {show("title") && <Row label="Title"><input value={track.title} onChange={(e) => editTrack({ title: e.target.value }, "track:title")} className={inputCls} /></Row>}
      {show("artist") && (
        <Row label="Artist">
          <input key={artists} defaultValue={artists} placeholder="Add artist (comma-separated)" className={inputCls}
            onBlur={(e) => commitArtists(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitArtists(e.currentTarget.value); }} />
        </Row>
      )}
      {show("album") && <Row label="Album"><input value={track.album ?? ""} onChange={(e) => editTrack({ album: e.target.value || null }, "track:album")} className={inputCls} /></Row>}
      {show("artist") && track.artists.length === 0 && <p className="text-[11px] text-muted">No artist found for this track. Type it in, then press Enter or click away.</p>}
    </>
  );
}
