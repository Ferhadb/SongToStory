"""Snippet rendering with ffmpeg: trim, gain, optional loudness normalization, fades -> AAC/m4a."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field, model_validator

from app.audio.media import MediaError, _run

MIN_SNIPPET_MS = 1000
MAX_SNIPPET_MS = 5 * 60 * 1000


class SnippetSpec(BaseModel):
    asset_id: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    fade_in_ms: int = Field(default=0, ge=0, le=10_000)
    fade_out_ms: int = Field(default=0, ge=0, le=10_000)
    gain_db: float = Field(default=0, ge=-30, le=12)
    normalize: bool = False

    @model_validator(mode="after")
    def _check(self):
        dur = self.end_ms - self.start_ms
        if dur < MIN_SNIPPET_MS:
            raise ValueError("Snippet must be at least 1 second.")
        if dur > MAX_SNIPPET_MS:
            raise ValueError("Snippet can be at most 5 minutes.")
        if self.fade_in_ms + self.fade_out_ms > dur:
            raise ValueError("Fades are longer than the snippet.")
        return self


def build_filter(spec: SnippetSpec) -> str:
    dur = (spec.end_ms - spec.start_ms) / 1000
    # Trim inside the graph and reset timestamps so fades are relative to the snippet start.
    f = [f"atrim=start={spec.start_ms / 1000:.3f}:end={spec.end_ms / 1000:.3f}", "asetpts=PTS-STARTPTS"]
    if spec.gain_db:
        f.append(f"volume={spec.gain_db}dB")
    if spec.normalize:
        f.append("loudnorm=I=-14:TP=-1.0:LRA=11")
    if spec.fade_in_ms:
        f.append(f"afade=t=in:st=0:d={spec.fade_in_ms / 1000}")
    if spec.fade_out_ms:
        f.append(f"afade=t=out:st={dur - spec.fade_out_ms / 1000}:d={spec.fade_out_ms / 1000}")
    return ",".join(f)


async def render_snippet(src: Path, dest: Path, spec: SnippetSpec, source_duration_ms: int | None) -> None:
    if source_duration_ms is not None and spec.end_ms > source_duration_ms + 250:
        raise MediaError("out_of_range", "The snippet extends past the end of the audio.")
    args = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(src), "-vn", "-af", build_filter(spec)]
    args += ["-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-f", "ipod", str(dest)]
    code, _, _ = await _run(args, 120)
    if code != 0 or not dest.exists():
        dest.unlink(missing_ok=True)
        raise MediaError("processing_failed", "Couldn't process that audio snippet.")
