"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  acquireYoutube,
  formatTime,
  getCandidates,
  uploadAudio,
  type Asset,
  type AudioCandidate,
  type Track,
} from "@/lib/api";

type Busy = { kind: "video"; id: string } | { kind: "url" } | { kind: "upload" } | null;

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

export default function AudioPicker({
  track,
  youtubeId,
  onPicked,
}: {
  track: Track;
  youtubeId: string | null; // set when the pasted link was itself a YouTube video
  onPicked: (a: Asset) => void;
}) {
  const [cands, setCands] = useState<AudioCandidate[] | null>(null);
  const [recommended, setRecommended] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(youtubeId ? { kind: "video", id: youtubeId } : null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoFailed, setAutoFailed] = useState(false);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    getCandidates(track)
      .then((r) => {
        setCands(r.candidates);
        setRecommended(r.recommended);
      })
      .catch((e) => setSearchError(msg(e)));
  }, [track]);

  const retry = () => {
    setCands(null);
    setSearchError(null);
    load();
  };

  const run = useCallback(
    async (b: NonNullable<Busy>, job: () => Promise<Asset>) => {
      setBusy(b);
      setError(null);
      try {
        onPicked(await job());
      } catch (e) {
        setError(msg(e));
      } finally {
        setBusy(null);
      }
    },
    [onPicked],
  );

  // A pasted YouTube link already names the recording: fetch it directly (no search needed).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!youtubeId) {
      load();
      return;
    }
    acquireYoutube({ video_id: youtubeId })
      .then(onPicked)
      .catch((e) => {
        setError(`${msg(e)} Pick another recording below.`);
        setAutoFailed(true);
        load();
      })
      .finally(() => setBusy(null));
  }, [youtubeId, load, onPicked]);

  const working = busy !== null;

  return (
    <section aria-label="Choose audio" className="w-full max-w-xl">
      <h2 className="font-serif text-2xl">Choose the recording</h2>
      <p className="mt-1 text-sm text-muted">
        {youtubeId && !autoFailed
          ? "Fetching audio from the YouTube video you pasted…"
          : "Pick the version that matches. Nothing is chosen for you."}
      </p>

      <div aria-live="polite" className="min-h-5 text-sm text-accent">
        {error}
      </div>

      {(!youtubeId || autoFailed) && (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {cands === null && !searchError && (
            <li className="py-6 text-sm text-muted">Searching YouTube…</li>
          )}
          {searchError && (
            <li className="py-4 text-sm">
              <span className="text-accent">{searchError}</span>{" "}
              <button onClick={retry} className="underline">
                Retry
              </button>
            </li>
          )}
          {cands?.length === 0 && <li className="py-6 text-sm text-muted">No results. Paste a link or upload a file below.</li>}
          {cands?.map((c) => (
            <li key={c.video_id} className="py-3">
              <div className="flex gap-3">
                {c.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumbnail} alt="" className="h-14 w-24 shrink-0 object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium">{c.title}</p>
                  <p className="truncate text-xs text-muted">
                    {c.channel}
                    {c.duration_s != null && <> · {formatTime(c.duration_s)}</>}
                    {c.official_channel && <> · artist channel</>}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className={c.video_id === recommended ? "font-medium text-accent" : "text-muted"}>
                      {c.video_id === recommended ? "Best match · " : "Match "}
                      {c.score}%
                    </span>
                    <button
                      className="text-muted underline"
                      aria-expanded={expanded === c.video_id}
                      onClick={() => setExpanded(expanded === c.video_id ? null : c.video_id)}
                    >
                      Why?
                    </button>
                    <button
                      className="text-muted underline"
                      onClick={() => setPreviewId(previewId === c.video_id ? null : c.video_id)}
                    >
                      {previewId === c.video_id ? "Close preview" : "Preview"}
                    </button>
                  </div>
                </div>
                <button
                  disabled={working}
                  onClick={() => run({ kind: "video", id: c.video_id }, () => acquireYoutube({ video_id: c.video_id }))}
                  className="h-8 shrink-0 self-center border border-fg px-3 text-xs disabled:opacity-40"
                >
                  {busy?.kind === "video" && busy.id === c.video_id ? "Downloading…" : "Use this"}
                </button>
              </div>
              {expanded === c.video_id && (
                <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                  {c.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {previewId === c.video_id && (
                <iframe
                  title={`Preview: ${c.title}`}
                  src={`https://www.youtube-nocookie.com/embed/${c.video_id}`}
                  allow="encrypted-media; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="mt-3 aspect-video w-full"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {youtubeId && busy && <p className="mt-4 text-sm text-muted">Downloading audio…</p>}

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run({ kind: "url" }, () => acquireYoutube({ url }));
          }}
        >
          <label htmlFor="yt-url" className="text-xs text-muted">
            Or paste a specific YouTube link
          </label>
          <div className="flex border-b border-fg">
            <input
              id="yt-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtu.be/…"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted"
            />
            <button disabled={working || !url.trim()} className="px-2 text-xs text-accent disabled:text-muted">
              {busy?.kind === "url" ? "Downloading…" : "Use"}
            </button>
          </div>
        </form>

        <div>
          <label htmlFor="audio-file" className="text-xs text-muted">
            Or upload your own audio (MP3, WAV, M4A, AAC, FLAC, OGG)
          </label>
          <input
            id="audio-file"
            ref={fileInput}
            type="file"
            accept=".mp3,.wav,.m4a,.aac,.flac,.ogg,audio/*"
            disabled={working}
            className="mt-1 block w-full text-xs file:mr-3 file:border file:border-fg file:bg-transparent file:px-3 file:py-1.5 file:text-fg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void run({ kind: "upload" }, () => uploadAudio(f));
              e.target.value = "";
            }}
          />
          {busy?.kind === "upload" && <p className="mt-1 text-xs text-muted">Uploading and checking…</p>}
        </div>
      </div>
    </section>
  );
}
