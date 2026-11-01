"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CoverCanvas from "./CoverCanvas";
import {
  ApiError, getArtworkCandidates, importArtwork, streamUrl, uploadImage,
  type ArtworkCandidate, type Asset, type Track,
} from "@/lib/api";
import {
  DEFAULT_COVER, GENERATED_STYLES, drawGenerated, extractPalette, isDefault, themeFromPalette, toHex,
  type CoverParams, type GeneratedStyle, type RGB, type Theme,
} from "@/lib/artwork";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

export interface CoverSelection {
  asset: Asset;
  params: CoverParams;
  theme: Theme | null; // null when color sync is off
}

export default function ArtworkSection({ track, onChange }: { track: Track; onChange?: (c: CoverSelection) => void }) {
  const [cands, setCands] = useState<ArtworkCandidate[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [asset, setAsset] = useState<Asset | null>(null);
  const [params, setParams] = useState<CoverParams>(DEFAULT_COVER);
  const [palette, setPalette] = useState<RGB[]>([]);
  const [sync, setSync] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const started = useRef(false);

  const generate = useCallback(async (style: GeneratedStyle) => {
    setBusy("Generating cover…");
    setError(null);
    try {
      await document.fonts.ready;
      const c = document.createElement("canvas");
      c.width = c.height = 1200;
      const family = getComputedStyle(document.body).fontFamily;
      drawGenerated(c.getContext("2d")!, style, track.title, track.artists[0]?.name ?? "", track.id, family);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/png"));
      setAsset(await uploadImage(blob, "generated-cover.png"));
      setParams(DEFAULT_COVER);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }, [track]);

  const take = useCallback(async (job: () => Promise<Asset>, label: string) => {
    setBusy(label);
    setError(null);
    try {
      setAsset(await job());
      setParams(DEFAULT_COVER);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }, []);

  // On mount: find candidates, adopt the first (platform original) so the cover is local and editable.
  // With nothing usable, fall back to a generated cover — never an empty/broken slot.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    getArtworkCandidates(track)
      .then(async (r) => {
        setCands(r.candidates);
        setWarnings(r.warnings);
        for (const c of r.candidates.slice(0, 3)) {
          try {
            setAsset(await importArtwork(c.url));
            return;
          } catch { /* try the next candidate */ }
        }
        await generate("typographic");
      })
      .catch(async (e) => {
        setCands([]);
        setError(msg(e));
        await generate("typographic");
      });
  }, [track, generate]);

  const theme = useMemo(() => (asset && sync && palette.length ? themeFromPalette(palette) : null), [asset, sync, palette]);
  useEffect(() => {
    if (asset) onChange?.({ asset, params, theme });
  }, [asset, params, theme, onChange]);

  const set = (k: keyof CoverParams) => (v: number) => setParams((p) => ({ ...p, [k]: v }));
  const visible = (cands ?? []).filter((c) => !broken.has(c.url));

  function onImage(img: HTMLImageElement) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 64, 64);
    setPalette(extractPalette(ctx.getImageData(0, 0, 64, 64).data));
  }

  return (
    <section aria-label="Cover artwork" className="w-full max-w-xl">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-2xl">Cover</h2>
        <button className="text-xs text-muted underline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide adjustments" : "Crop & adjust"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-5">
        <div className="shrink-0">
          {asset ? (
            <div style={theme ? { background: toHex(theme.background) } : undefined} className="p-3">
              <CoverCanvas
                src={streamUrl(asset.id)} params={params} size={200} onLoad={onImage}
                onPan={open ? (dx, dy) => setParams((p) => ({
                  ...p, offsetX: Math.max(-1, Math.min(1, p.offsetX + dx)), offsetY: Math.max(-1, Math.min(1, p.offsetY + dy)),
                })) : undefined}
              />
              {theme && (
                <div className="mt-2 flex items-center gap-1.5" title="Suggested theme from this cover">
                  {palette.slice(0, 5).map((c) => <span key={toHex(c)} className="size-4 border border-white/20" style={{ background: toHex(c) }} />)}
                  <span className="ml-1 text-xs" style={{ color: toHex(theme.text) }}>Aa</span>
                  <span className="size-2" style={{ background: toHex(theme.accent) }} />
                </div>
              )}
            </div>
          ) : (
            <div style={{ width: 224, height: 224 }} className="flex items-center justify-center border border-line text-xs text-muted">
              {busy ?? "Finding artwork…"}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 text-xs">
          <p className="text-muted">Choose a cover</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {cands === null && <li className="text-muted">Searching…</li>}
            {visible.map((c) => (
              <li key={c.url} className="w-16">
                <button
                  disabled={!!busy}
                  onClick={() => void take(() => importArtwork(c.url), "Importing…")}
                  className="block w-full border border-line disabled:opacity-40"
                  title={`${c.label}${c.verified ? "" : " (suggestion, not verified)"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt={c.label} className="aspect-square w-full object-cover"
                    onError={() => setBroken((b) => new Set(b).add(c.url))} referrerPolicy="no-referrer" />
                </button>
                <span className={`mt-0.5 block truncate ${c.verified ? "text-fg" : "text-muted"}`}>
                  {c.verified ? "Verified" : "Suggestion"}
                </span>
              </li>
            ))}
          </ul>
          {warnings.length > 0 && <p className="mt-1 text-muted">Some sources were unavailable.</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer border border-fg px-3 py-1.5">
              Upload your own
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={!!busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void take(() => uploadImage(f, f.name), "Uploading…"); e.target.value = ""; }} />
            </label>
            <span className="text-muted">or generate:</span>
            {GENERATED_STYLES.map((g) => (
              <button key={g.id} disabled={!!busy} onClick={() => void generate(g.id)} className="underline disabled:opacity-40">{g.label}</button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-muted">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Match theme colors to the cover
          </label>
          <div aria-live="polite" className="mt-2 min-h-4 text-accent">{error ?? (busy && asset ? busy : "")}</div>
        </div>
      </div>

      {open && asset && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Slider label="Zoom" v={params.zoom} min={1} max={4} step={0.05} on={set("zoom")} fmt={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Rotation" v={params.rotation} min={-180} max={180} step={1} on={set("rotation")} fmt={(v) => `${v}°`} />
          <Slider label="Position X" v={params.offsetX} min={-1} max={1} step={0.01} on={set("offsetX")} fmt={(v) => v.toFixed(2)} />
          <Slider label="Position Y" v={params.offsetY} min={-1} max={1} step={0.01} on={set("offsetY")} fmt={(v) => v.toFixed(2)} />
          <Slider label="Corner radius" v={params.radius} min={0} max={50} step={1} on={set("radius")} fmt={(v) => `${v}%`} />
          <Slider label="Brightness" v={params.brightness} min={0} max={200} step={1} on={set("brightness")} fmt={(v) => `${v}%`} />
          <Slider label="Contrast" v={params.contrast} min={0} max={200} step={1} on={set("contrast")} fmt={(v) => `${v}%`} />
          <Slider label="Saturation" v={params.saturation} min={0} max={200} step={1} on={set("saturation")} fmt={(v) => `${v}%`} />
          <Slider label="Blur" v={params.blur} min={0} max={40} step={0.5} on={set("blur")} fmt={(v) => `${v}px`} />
          <Slider label="Grain" v={params.grain} min={0} max={100} step={1} on={set("grain")} fmt={(v) => `${v}%`} />
          <div className="sm:col-span-2">
            <button disabled={isDefault(params)} onClick={() => setParams(DEFAULT_COVER)} className="text-xs underline disabled:opacity-40">
              Reset adjustments
            </button>
            <span className="ml-3 text-xs text-muted">Tip: drag the cover to reposition it.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function Slider({ label, v, min, max, step, on, fmt }: {
  label: string; v: number; min: number; max: number; step: number; on: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <label className="block text-xs text-muted">
      <span className="flex justify-between">{label} <span className="font-mono text-fg">{fmt(v)}</span></span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--accent)]" />
    </label>
  );
}
