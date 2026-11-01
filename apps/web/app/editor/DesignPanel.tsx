"use client";

import { ASPECTS, ASPECT_IDS, TYPE_PAIRS, hasNewerDesign, pairSupports, templateVersionOf, type AspectId } from "@mss/compositions";
import { useEditor } from "@/lib/editor/store";
import DesignAdvanced from "./DesignAdvanced";
import LyricsControls from "./LyricsControls";
import PhotoControls from "./PhotoControls";
import TemplateGallery from "./TemplateGallery";
import TrackFields from "./TrackFields";
import { Advanced, Section, Select } from "./fields";

const FORMAT_NOTE: Record<AspectId, string> = { "9:16": "Story · Reel", "1:1": "Square", "4:5": "Portrait", "16:9": "Landscape" };
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** The simple starting view: pick a look and a format, check the song, choose type. Everything finer is under Advanced or in Edit. */
export default function DesignPanel({ onClip }: { onClip: () => void }) {
  const p = useEditor((s) => s.project)!;
  const st = useEditor.getState;
  const older = hasNewerDesign(p);
  const texts = [p.track.title, p.track.artists.join(", ")];
  const photoStory = p.templateId === "photo-story";

  return (
    <>
      {older && (
        <div className="border-b border-line bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-4 py-3 text-xs">
          <p>This story keeps the layout it was made with. The refreshed design has better spacing and title fitting.</p>
          <button className="mt-2 border border-[var(--accent)] px-2.5 py-1 font-medium" onClick={() => st().chooseTemplate(p.templateId)}>Use the new look</button>
          <p className="mt-1 text-[11px] text-muted">Your edits to elements are replaced; you can undo this.</p>
        </div>
      )}
      <Section title="Template"><TemplateGallery /></Section>
      <Section title="Format">
        <div role="radiogroup" aria-label="Format" className="grid grid-cols-2 gap-1.5">
          {ASPECT_IDS.map((a) => (
            <button key={a} role="radio" aria-checked={a === p.canvas.aspect} onClick={() => st().chooseAspect(a)}
              className={`border px-2 py-1.5 text-left text-xs ${a === p.canvas.aspect ? "border-[var(--accent)]" : "border-line"}`}>
              {a}<span className="block text-[10px] text-muted">{FORMAT_NOTE[a]} · {ASPECTS[a].w}×{ASPECTS[a].h}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Track details"><TrackFields only={undefined} /></Section>
      {photoStory && <PhotoControls />}
      <Section title="Typography">
        {templateVersionOf(p) < 2 ? (
          <p className="text-xs text-muted">Typography choices come with the new look.</p>
        ) : (
          <div role="radiogroup" aria-label="Typography" className="grid grid-cols-2 gap-1.5">
            <TypeChip label="Template" note="Its own pairing" on={!p.typePair} onClick={() => st().chooseTypePair(undefined)} />
            {TYPE_PAIRS.map((t) => {
              const ok = pairSupports(t, ...texts);
              return <TypeChip key={t.id} label={t.name} note={ok ? t.note : "No Cyrillic letters"} font={t.heading.font} on={p.typePair === t.id} disabled={!ok} onClick={() => st().chooseTypePair(t.id)} />;
            })}
          </div>
        )}
      </Section>
      <Section title="Song clip">
        <p className="mb-2 text-xs text-muted">{p.audio.snippet ? `Playing ${mmss(p.audio.snippet.startMs)}–${mmss(p.audio.snippet.endMs)} of the song.` : "No clip chosen yet."}</p>
        <button onClick={onClip} className="border border-line px-2.5 py-1 text-xs hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]">Change clip…</button>
      </Section>
      {p.templateId === "lyrics" && <LyricsControls />}
      <Advanced title="Advanced">
        <Section title="Progress bar shows">
          <Select label="Timeline" value={p.progress.mode} options={[{ value: "snippet", label: "Clip" }, { value: "original", label: "Whole song" }]}
            onChange={(v) => st().edit((d) => { d.progress.mode = v; })} />
        </Section>
        <DesignAdvanced />
      </Advanced>
    </>
  );
}

function TypeChip({ label, note, font, on, disabled, onClick }: { label: string; note: string; font?: string; on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button role="radio" aria-checked={on} disabled={disabled} onClick={onClick}
      className={`border px-2 py-1.5 text-left text-xs disabled:opacity-40 ${on ? "border-[var(--accent)]" : "border-line"}`}>
      <span className="block text-sm" style={font ? { fontFamily: `"${font}", var(--font-sans), sans-serif` } : undefined}>{label}</span>
      <span className="block text-[10px] text-muted">{note}</span>
    </button>
  );
}
