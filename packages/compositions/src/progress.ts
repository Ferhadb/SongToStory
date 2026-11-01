import { durationMsOf, type Project } from "./schema";

export const formatClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export interface ProgressInfo { fraction: number; elapsedMs: number; totalMs: number; remainingMs: number }

/** Playback progress at `frame`. "snippet" spans the story; "original" spans the whole source track. */
export function progressAt(p: Project, frame: number): ProgressInfo {
  const storyElapsed = (frame / p.canvas.fps) * 1000;
  const sn = p.audio.snippet;
  const trackMs = p.audio.sourceDurationMs ?? p.track.durationMs;
  if (p.progress.mode === "original" && sn && trackMs) {
    const elapsed = Math.min(trackMs, sn.startMs + storyElapsed);
    return { fraction: elapsed / trackMs, elapsedMs: elapsed, totalMs: trackMs, remainingMs: trackMs - elapsed };
  }
  const total = durationMsOf(p);
  const elapsed = Math.min(total, storyElapsed);
  return { fraction: total ? elapsed / total : 0, elapsedMs: elapsed, totalMs: total, remainingMs: total - elapsed };
}
