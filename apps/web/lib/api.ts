export type Platform =
  | "spotify"
  | "youtube"
  | "youtube_music"
  | "soundcloud"
  | "deezer"
  | "apple_music"
  | "bandcamp";

export interface ParsedLink {
  platform: Platform;
  kind: string;
  external_id: string;
  canonical_url: string;
  extra: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Track {
  id: string;
  title: string;
  artists: { name: string; role: string }[];
  album: { name: string | null };
  duration_ms: number | null;
  artwork: { original: { url: string; verified: boolean } | null };
}

export interface ResolveResult {
  link: ParsedLink;
  track: Track;
  warnings: string[];
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("network", "Couldn't reach the server. Is the API running?");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.detail?.error;
    throw new ApiError(err?.code ?? "unknown", err?.message ?? "Something went wrong.");
  }
  return body as T;
}

const postJson = <T>(path: string, data: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export const resolveLink = (url: string) => postJson<ResolveResult>("/api/v1/resolve", { url });

export interface AudioCandidate {
  video_id: string;
  title: string;
  channel: string;
  duration_s: number | null;
  thumbnail: string | null;
  url: string;
  score: number;
  reasons: string[];
  official_channel: boolean;
}

export interface ArtworkCandidate {
  url: string;
  origin: string;
  label: string;
  verified: boolean;
}

export interface Asset {
  id: string;
  kind: string;
  origin: string;
  mime: string;
  size: number;
  duration_ms: number | null;
  width?: number | null;
  height?: number | null;
  title: string | null;
}

export const getCandidates = (track: Track) =>
  postJson<{ candidates: AudioCandidate[]; recommended: string | null }>("/api/v1/audio/candidates", { track });

export const acquireYoutube = (src: { video_id: string } | { url: string }) =>
  postJson<Asset>("/api/v1/audio/youtube", src);

export const uploadAudio = (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return request<Asset>("/api/v1/uploads/audio", { method: "POST", body: fd });
};

export const fetchLyrics = (a: { title: string; artist: string; durationMs: number | null; startMs: number; endMs: number; snippetAssetId: string }) =>
  postJson<{ lines: { startMs: number; endMs: number; text: string }[]; source: "lrclib" | "whisper" }>("/api/v1/audio/lyrics", {
    title: a.title, artist: a.artist, duration_ms: a.durationMs, start_ms: a.startMs, end_ms: a.endMs, snippet_asset_id: a.snippetAssetId,
  });

export const createSnippet = (assetId: string, sn: import("./snippet").Snippet) =>
  postJson<Asset>("/api/v1/audio/snippet", {
    asset_id: assetId,
    start_ms: sn.startMs,
    end_ms: sn.endMs,
    fade_in_ms: sn.fadeInMs,
    fade_out_ms: sn.fadeOutMs,
    gain_db: sn.gainDb,
    normalize: sn.normalize,
  });

export const getArtworkCandidates = (track: Track) =>
  postJson<{ candidates: ArtworkCandidate[]; warnings: string[] }>("/api/v1/artwork/candidates", { track });

export const importArtwork = (url: string) => postJson<Asset>("/api/v1/artwork/import", { url });

export const uploadImage = (file: File | Blob, name = "cover.png") => {
  const fd = new FormData();
  fd.append("file", file, name);
  return request<Asset>("/api/v1/uploads/image", { method: "POST", body: fd });
};

/** A personal picture for a Photo Story background; the server straightens, converts to sRGB and caps its size. */
export const uploadPhoto = (file: File | Blob, name = "photo.jpg") => {
  const fd = new FormData();
  fd.append("file", file, name);
  return request<Asset>("/api/v1/uploads/photo", { method: "POST", body: fd });
};

export const getAsset = (id: string) => request<Asset>(`/api/v1/assets/${id}`, {});

export const assetUrl = (id: string) => `/api/v1/assets/${id}/stream`;

export const getWaveform = (id: string, bins = 600) =>
  request<{ duration_ms: number; peaks: number[] }>(`/api/v1/assets/${id}/waveform?bins=${bins}`, {});

export const streamUrl = (id: string) => `/api/v1/assets/${id}/stream`;

export function formatMs(ms: number): string {
  const t = Math.max(0, ms) / 1000;
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
}

export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  spotify: "Spotify",
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  soundcloud: "SoundCloud",
  deezer: "Deezer",
  apple_music: "Apple Music",
  bandcamp: "Bandcamp",
};

// ---------- exports ----------

export type RenderStatus = "queued" | "preparing" | "rendering" | "encoding" | "finalizing" | "completed" | "failed" | "cancelled";
export interface RenderRow {
  id: string;
  status: RenderStatus;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  title: string;
  filename: string;
  quality: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  size_bytes: number | null;
  created_at: string;
  finished_at: string | null;
}
export const RENDER_DONE: RenderStatus[] = ["completed", "failed", "cancelled"];

export const createRender = (project: unknown, quality: string) => postJson<RenderRow>("/api/v1/renders", { project, quality });
export const getRender = (id: string) => request<RenderRow>(`/api/v1/renders/${id}`, {});
export const listRenders = () => request<RenderRow[]>("/api/v1/renders", {});
export const cancelRender = (id: string) => request<RenderRow>(`/api/v1/renders/${id}/cancel`, { method: "POST" });
export const deleteRender = (id: string) => request<null>(`/api/v1/renders/${id}`, { method: "DELETE" });
export const downloadUrl = (id: string) => `/api/v1/renders/${id}/download`;
export const previewUrlOf = (id: string) => `/api/v1/renders/${id}/download?inline=true`;
export const renderEventsUrl = (id: string) => `/api/v1/renders/${id}/events`;
