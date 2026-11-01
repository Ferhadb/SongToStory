"use client";

import { Thumbnail } from "@remotion/player";
import { useMemo } from "react";
import { ASPECTS, Story, TEMPLATES, applyTemplate, durationFramesOf } from "@mss/compositions";
import { useEditor } from "@/lib/editor/store";

const BOX_W = 124;
const BOX_H = 150;

/** Visual template choices: each cell previews the template on this story's own song, photo and format. */
export default function TemplateGallery() {
  const p = useEditor((s) => s.project)!;
  const { w: W, h: H } = ASPECTS[p.canvas.aspect];
  const scale = Math.min(BOX_W / W, BOX_H / H);
  const tw = Math.round(W * scale), th = Math.round(H * scale);
  // Previews only depend on what shows in them, not on element edits, so dragging on the canvas doesn't rebuild seven thumbnails.
  const { track, theme, artwork, photo, canvas } = p;
  const base = useMemo(() => ({ ...p }), [track, theme, artwork, photo, canvas, p.audio.snippet?.endMs, p.audio.snippet?.startMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const previews = useMemo(() => TEMPLATES.map((t) => ({ t, project: applyTemplate(base, t.id) })), [base]);
  const lastFrame = (pr: typeof base) => Math.min(durationFramesOf(pr) - 1, Math.round(pr.canvas.fps * 3));

  return (
    <div role="radiogroup" aria-label="Template" className="grid grid-cols-2 gap-2">
      {previews.map(({ t, project }) => {
        const on = t.id === p.templateId;
        return (
          <button key={t.id} role="radio" aria-checked={on} title={t.description}
            onClick={() => { if (!on) useEditor.getState().chooseTemplate(t.id); }}
            className={`flex flex-col items-center gap-1.5 border p-1.5 text-center ${on ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : "border-line hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)]"}`}>
            <span className="grid place-items-center overflow-hidden bg-black/20" style={{ width: BOX_W, height: BOX_H }}>
              <span className="pointer-events-none block overflow-hidden" style={{ width: tw, height: th }}>
                <Thumbnail
                  component={Story}
                  inputProps={{ project, assetBase: "/api/v1/assets", staticPreview: true }}
                  compositionWidth={W} compositionHeight={H}
                  durationInFrames={durationFramesOf(project)} fps={project.canvas.fps}
                  frameToDisplay={lastFrame(project)}
                  style={{ width: tw, height: th }}
                />
              </span>
            </span>
            <span className="text-xs font-medium">{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}
