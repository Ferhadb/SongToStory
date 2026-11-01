"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError, RENDER_DONE, cancelRender, createRender, deleteRender, downloadUrl, getRender, listRenders,
  previewUrlOf, renderEventsUrl, type RenderRow,
} from "@/lib/api";
import { useEditor } from "@/lib/editor/store";
import { ASPECTS, durationMsOf } from "@mss/compositions";

const QUALITIES = [
  { id: "draft", label: "Draft", note: "Half resolution, fastest" },
  { id: "standard", label: "Standard", note: "Full resolution" },
  { id: "high", label: "High", note: "Full resolution, larger file" },
] as const;

const STAGE: Record<string, string> = {
  queued: "Waiting in the queue…", preparing: "Preparing (first export bundles the renderer)…", rendering: "Rendering frames…",
  encoding: "Encoding…", finalizing: "Finalizing…", completed: "Done", failed: "Failed", cancelled: "Cancelled",
};

const mb = (n: number | null) => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : "");

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]["id"]>("standard");
  const [job, setJob] = useState<RenderRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RenderRow[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);

  const refreshHistory = useCallback(() => { listRenders().then(setHistory, () => undefined); }, []);
  useEffect(() => { refreshHistory(); closeRef.current?.focus(); }, [refreshHistory]);
  // Exports started earlier (dialog hidden while rendering) keep updating in the list.
  const anyRunning = history.some((r) => !RENDER_DONE.includes(r.status));
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(refreshHistory, 2000);
    return () => clearInterval(t);
  }, [anyRunning, refreshHistory]);

  // Live progress: SSE, falling back to polling if the stream drops before the job finishes.
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const apply = (r: RenderRow) => { if (!stopped) { setJob(r); if (RENDER_DONE.includes(r.status)) { es.close(); clearInterval(poll); refreshHistory(); } } };
    const es = new EventSource(renderEventsUrl(jobId));
    es.addEventListener("progress", (e) => apply(JSON.parse((e as MessageEvent).data)));
    es.onerror = () => {
      es.close();
      if (!poll) poll = setInterval(() => { getRender(jobId).then(apply, () => undefined); }, 1000);
    };
    return () => { stopped = true; es.close(); clearInterval(poll); };
  }, [jobId, refreshHistory]);

  async function start() {
    setError(null);
    try {
      setJob(await createRender(project, quality));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start the export.");
    }
  }

  const running = job && !RENDER_DONE.includes(job.status);
  const q = QUALITIES.find((x) => x.id === quality)!;
  const { w, h } = ASPECTS[project.canvas.aspect];
  const scale = quality === "draft" ? 0.5 : 1;
  const secs = durationMsOf(project) / 1000;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="Export video"
      onKeyDown={(e) => { if (e.key === "Escape" && !running) onClose(); }}>
      <div className="max-h-full w-full max-w-lg overflow-y-auto border border-line bg-[var(--bg)] p-5 text-[var(--fg)]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Export video</h2>
          <button ref={closeRef} onClick={onClose} className="text-xs text-muted underline">{running ? "Hide (keeps rendering)" : "Close"}</button>
        </div>

        {!job && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Quality">
              {QUALITIES.map((o) => (
                <button key={o.id} role="radio" aria-checked={quality === o.id} onClick={() => setQuality(o.id)}
                  className={`border px-2 py-2 text-left text-xs ${quality === o.id ? "border-[var(--accent)]" : "border-line"}`}>
                  <span className="block font-medium">{o.label}</span><span className="text-muted">{o.note}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              MP4 (H.264 + AAC), {Math.round(w * scale)}×{Math.round(h * scale)}, {project.canvas.fps} fps, {secs.toFixed(1)}s. {q.note}.
            </p>
            {!project.audio.snippetAssetId && <p className="mt-2 text-xs text-muted">No audio snippet is attached, so the video will be silent.</p>}
            {error && <p role="alert" className="mt-3 text-xs text-[#ff6b5a]">{error}</p>}
            <button onClick={start} className="mt-4 w-full bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white">Start export</button>
          </>
        )}

        {job && (
          <div className="mt-4">
            <p className="text-sm">{job.filename}</p>
            {running && (
              <>
                <div className="mt-3 h-2 w-full bg-[color-mix(in_srgb,var(--fg)_15%,transparent)]" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted" aria-live="polite">{STAGE[job.status]} {job.status === "rendering" ? `${Math.round(job.progress * 100)}%` : ""}</p>
                <button onClick={() => { void cancelRender(job.id).then(setJob, () => undefined); }} className="mt-3 border border-line px-3 py-1.5 text-xs">Cancel</button>
              </>
            )}
            {job.status === "completed" && (
              <>
                <video src={previewUrlOf(job.id)} controls className="mx-auto mt-3 max-h-[50vh] bg-black" />
                <p className="mt-2 text-xs text-muted">{job.width}×{job.height} · {((job.duration_ms ?? 0) / 1000).toFixed(1)}s · {mb(job.size_bytes)}</p>
                <div className="mt-3 flex gap-2">
                  <a href={downloadUrl(job.id)} download={job.filename} className="flex-1 bg-[var(--accent)] px-4 py-2.5 text-center text-sm font-medium text-white">Download MP4</a>
                  <button onClick={() => setJob(null)} className="border border-line px-3 text-xs">Export again</button>
                </div>
              </>
            )}
            {(job.status === "failed" || job.status === "cancelled") && (
              <>
                <p role="alert" className="mt-3 text-xs text-[#ff6b5a]">{job.status === "cancelled" ? "Export cancelled." : job.error_message}</p>
                <button onClick={() => setJob(null)} className="mt-3 border border-line px-3 py-1.5 text-xs">Try again</button>
              </>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-6 border-t border-line pt-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted">Recent exports</h3>
            <ul className="mt-1">
              {history.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="text-muted">{r.status === "completed" ? mb(r.size_bytes) : STAGE[r.status]?.replace("…", "")}</span>
                  {r.status === "completed" && <a className="underline" href={downloadUrl(r.id)} download={r.filename}>Download</a>}
                  {RENDER_DONE.includes(r.status) && (
                    <button className="text-muted underline" onClick={() => { void deleteRender(r.id).then(refreshHistory, () => undefined); }}>Delete</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
