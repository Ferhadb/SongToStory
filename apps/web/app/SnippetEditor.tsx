"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Waveform from "./Waveform";
import {
  ApiError,
  createSnippet,
  formatMs,
  getWaveform,
  streamUrl,
  type Asset,
} from "@/lib/api";
import {
  MIN_MS,
  PRESETS_S,
  defaultSnippet,
  durationOf,
  fit,
  previewGain,
  withDuration,
  type Snippet,
} from "@/lib/snippet";

type Drag = "start" | "end" | "move";

export default function SnippetEditor({
  asset,
  initial,
  onChangeAudio,
  onReady,
  onDirty,
}: {
  asset: Asset;
  /** Start from this selection (reopening an existing clip) instead of the default one. */
  initial?: Snippet;
  /** Omit to hide the link, e.g. when the clip of an existing story is being re-cut. */
  onChangeAudio?: () => void;
  onReady: (snippet: Asset, spec: Snippet) => void;
  /** Fired when the selection changes after it was last applied. */
  onDirty?: () => void;
}) {
  const trackMs = asset.duration_ms ?? 0;
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [peakError, setPeakError] = useState<string | null>(null);
  const [sn, setSn] = useState<Snippet>(() => (initial ? fit(initial, trackMs) : defaultSnippet(trackMs)));
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [headMs, setHeadMs] = useState(0);
  const [customS, setCustomS] = useState("");
  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const gainNode = useRef<GainNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const tickRef = useRef<() => void>(() => {});
  const raf = useRef(0);
  const snRef = useRef(sn);
  const loopRef = useRef(loop);
  const drag = useRef<{ mode: Drag; grabMs: number; start: Snippet } | null>(null);

  useEffect(() => {
    snRef.current = sn;
  }, [sn]);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    let live = true;
    getWaveform(asset.id, 800)
      .then((w) => live && setPeaks(w.peaks))
      .catch((e) => live && setPeakError(e instanceof ApiError ? e.message : "Couldn't draw the waveform."));
    return () => {
      live = false;
    };
  }, [asset.id]);

  const update = useCallback(
    (next: Snippet) => {
      setSn(fit(next, trackMs));
      setRendered(null);
      onDirty?.();
    },
    [trackMs, onDirty],
  );

  // ---- preview playback (rAF drives fades/gain + snippet boundaries) ----
  const tick = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    const s = snRef.current;
    const t = a.currentTime * 1000;
    if (t >= s.endMs) {
      if (loopRef.current) {
        a.currentTime = s.startMs / 1000;
      } else {
        a.pause();
        a.currentTime = s.startMs / 1000;
        setHeadMs(s.startMs);
        return;
      }
    }
    if (gainNode.current) gainNode.current.gain.value = previewGain(s, a.currentTime * 1000);
    setHeadMs(a.currentTime * 1000);
    raf.current = requestAnimationFrame(() => tickRef.current());
  }, []);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  async function togglePlay() {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    if (!gainNode.current) {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(a);
      const g = ctx.createGain();
      src.connect(g).connect(ctx.destination);
      gainNode.current = g;
      ctxRef.current = ctx;
    }
    await ctxRef.current?.resume();
    const t = a.currentTime * 1000;
    if (t < sn.startMs || t >= sn.endMs) a.currentTime = sn.startMs / 1000;
    try {
      await a.play();
    } catch {
      // The element can lose its source (hot reload, interrupted load); reload it once before giving up.
      try {
        a.load();
        a.currentTime = sn.startMs / 1000;
        await a.play();
        setError(null);
      } catch {
        setError("Couldn't play this audio in your browser. Try re-adding the audio, or upload a file instead.");
      }
    }
  }

  function seekTo(fraction: number) {
    const a = audio.current;
    if (!a) return;
    const ms = Math.min(sn.endMs - 1, Math.max(sn.startMs, fraction * trackMs));
    a.currentTime = ms / 1000;
    setHeadMs(ms);
  }

  // ---- selection dragging ----
  const msAt = (clientX: number, r: DOMRect) =>
    Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * trackMs;

  function startDrag(e: React.PointerEvent, mode: Drag) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, grabMs: msAt(e.clientX, box.current!.getBoundingClientRect()), start: sn };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const ms = msAt(e.clientX, box.current!.getBoundingClientRect());
    const s0 = d.start;
    if (d.mode === "start") update({ ...s0, startMs: Math.min(ms, s0.endMs - MIN_MS) });
    else if (d.mode === "end") update({ ...s0, endMs: Math.max(ms, s0.startMs + MIN_MS) });
    else {
      const len = durationOf(s0);
      const start = Math.min(trackMs - len, Math.max(0, s0.startMs + (ms - d.grabMs)));
      update({ ...s0, startMs: start, endMs: start + len });
    }
  }

  const endDrag = () => {
    drag.current = null;
  };

  function nudge(which: "startMs" | "endMs", e: React.KeyboardEvent) {
    const step = e.shiftKey ? 1000 : 100;
    if (e.key === "ArrowLeft") update({ ...sn, [which]: sn[which] - step });
    else if (e.key === "ArrowRight") update({ ...sn, [which]: sn[which] + step });
    else return;
    e.preventDefault();
  }

  async function apply() {
    setRendering(true);
    setError(null);
    try {
      const r = await createSnippet(asset.id, sn);
      setRendered(r);
      onReady(r, sn);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't process the snippet.");
    } finally {
      setRendering(false);
    }
  }

  const pct = (ms: number) => `${(ms / trackMs) * 100}%`;
  const len = durationOf(sn);
  const fadeMax = Math.min(10_000, len);

  return (
    <section aria-label="Snippet" className="w-full max-w-xl border border-line p-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="min-w-0 truncate text-sm font-medium">{asset.title ?? "Audio"}</p>
        {onChangeAudio && (
          <button onClick={onChangeAudio} className="shrink-0 text-xs text-muted underline">
            Change audio
          </button>
        )}
      </div>

      <div ref={box} className="relative mt-3 select-none touch-none" onPointerMove={onPointerMove} onPointerUp={endDrag}>
        {peaks ? (
          <Waveform peaks={peaks} progress={trackMs ? headMs / trackMs : 0} onSeek={seekTo} />
        ) : (
          <div className="flex h-20 items-center text-xs text-muted">{peakError ?? "Analyzing audio…"}</div>
        )}
        {peaks && (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-bg/70" style={{ width: pct(sn.startMs) }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 bg-bg/70" style={{ left: pct(sn.endMs) }} />
            <div
              className="absolute inset-y-0 cursor-grab border-y border-accent active:cursor-grabbing"
              style={{ left: pct(sn.startMs), width: pct(len) }}
              onPointerDown={(e) => startDrag(e, "move")}
              title="Drag to move the snippet"
            />
            {(["start", "end"] as const).map((h) => (
              <div
                key={h}
                role="slider"
                tabIndex={0}
                aria-label={h === "start" ? "Snippet start" : "Snippet end"}
                aria-valuemin={0}
                aria-valuemax={trackMs}
                aria-valuenow={h === "start" ? sn.startMs : sn.endMs}
                aria-valuetext={formatMs(h === "start" ? sn.startMs : sn.endMs)}
                className="absolute inset-y-0 -ml-2 w-4 cursor-ew-resize"
                style={{ left: pct(h === "start" ? sn.startMs : sn.endMs) }}
                onPointerDown={(e) => startDrag(e, h)}
                onKeyDown={(e) => nudge(h === "start" ? "startMs" : "endMs", e)}
              >
                <div className="mx-auto h-full w-1 bg-accent" />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <button
          onClick={() => void togglePlay()}
          className="rounded-sm border border-fg px-3 py-1 text-fg"
          aria-label={playing ? "Pause snippet" : "Play snippet"}
        >
          {playing ? "Pause" : "Play snippet"}
        </button>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
        </label>
        <span className="font-mono text-fg">
          {formatMs(sn.startMs)} – {formatMs(sn.endMs)} · {(len / 1000).toFixed(1)}s
        </span>
      </div>

      <fieldset className="mt-5">
        <legend className="text-xs text-muted">Length</legend>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {PRESETS_S.map((p) => (
            <button
              key={p}
              disabled={p * 1000 > trackMs}
              aria-pressed={len === p * 1000}
              onClick={() => update(withDuration(sn, p * 1000, trackMs))}
              className="border border-line px-3 py-1 text-xs aria-pressed:border-accent aria-pressed:text-accent disabled:opacity-30"
            >
              {p}s
            </button>
          ))}
          <label className="flex items-center gap-1 text-xs text-muted">
            Custom
            <input
              inputMode="decimal"
              value={customS}
              onChange={(e) => setCustomS(e.target.value)}
              onBlur={() => {
                const v = parseFloat(customS);
                if (Number.isFinite(v)) update(withDuration(sn, v * 1000, trackMs));
                setCustomS("");
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder={(len / 1000).toFixed(1)}
              className="w-14 border-b border-fg bg-transparent px-1 py-0.5 text-fg outline-none"
            />
            s
          </label>
        </div>
      </fieldset>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Range label="Fade in" value={sn.fadeInMs} min={0} max={fadeMax} step={100}
          fmt={(v) => `${(v / 1000).toFixed(1)}s`} onChange={(v) => update({ ...sn, fadeInMs: v })} />
        <Range label="Fade out" value={sn.fadeOutMs} min={0} max={fadeMax} step={100}
          fmt={(v) => `${(v / 1000).toFixed(1)}s`} onChange={(v) => update({ ...sn, fadeOutMs: v })} />
        <Range label="Volume" value={sn.gainDb} min={-24} max={6} step={0.5}
          fmt={(v) => `${v > 0 ? "+" : ""}${v} dB`} onChange={(v) => update({ ...sn, gainDb: v })} />
        <label className="flex items-center gap-2 self-end text-xs text-muted">
          <input type="checkbox" checked={sn.normalize} onChange={(e) => update({ ...sn, normalize: e.target.checked })} />
          Normalize loudness (−14 LUFS)
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">
        Live preview approximates fades and volume; loudness normalization is only applied when you confirm.
      </p>

      <div aria-live="polite" className="mt-3 min-h-5 text-xs text-accent">{error}</div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={() => void apply()}
          disabled={rendering}
          className="border border-fg px-4 py-2 text-sm disabled:opacity-40"
        >
          {rendering ? "Processing…" : rendered ? "Re-process snippet" : "Use this snippet"}
        </button>
        {rendered && (
          <>
            <span className="text-xs text-muted">Ready · {((rendered.duration_ms ?? 0) / 1000).toFixed(1)}s</span>
            <audio controls src={streamUrl(rendered.id)} className="h-8" />
          </>
        )}
      </div>

      <audio
        ref={audio}
        src={streamUrl(asset.id)}
        preload="auto"
        onPlay={() => {
          setPlaying(true);
          raf.current = requestAnimationFrame(() => tickRef.current());
        }}
        onPause={() => {
          setPlaying(false);
          cancelAnimationFrame(raf.current);
        }}
      />
    </section>
  );
}

function Range({
  label, value, min, max, step, fmt, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs text-muted">
      <span className="flex justify-between">
        {label} <span className="font-mono text-fg">{fmt(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
    </label>
  );
}
