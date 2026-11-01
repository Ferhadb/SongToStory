"""Media validation (magic bytes + ffprobe) and waveform. No shell; args are lists."""

from __future__ import annotations

import array
import asyncio
import json
from pathlib import Path


class MediaError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def sniff_audio(head: bytes) -> str | None:
    """Return a container hint from the first bytes, or None if not a supported audio format."""
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return "aac" if (head[1] & 0xF6) == 0xF0 else "mp3"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[4:8] == b"ftyp":
        return "m4a"
    if head[:4] == b"fLaC":
        return "flac"
    if head[:4] == b"OggS":
        return "ogg"
    return None


async def _run(args: list[str], timeout: int) -> tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        raise MediaError("timeout", "Media processing timed out.") from None
    return proc.returncode or 0, out, err


async def probe_audio(path: Path, max_seconds: int) -> dict:
    code, out, _ = await _run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], 30
    )
    if code != 0:
        raise MediaError("invalid_media", "That file couldn't be read as audio.")
    info = json.loads(out or b"{}")
    streams = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise MediaError("invalid_media", "No audio stream found in that file.")
    dur = float(info.get("format", {}).get("duration") or streams[0].get("duration") or 0)
    if dur <= 0:
        raise MediaError("invalid_media", "Couldn't determine the audio duration.")
    if dur > max_seconds:
        raise MediaError("too_long", f"Audio is longer than the {max_seconds // 60}-minute limit.")
    return {"duration_ms": round(dur * 1000), "codec": streams[0].get("codec_name")}


async def waveform_peaks(path: Path, bins: int = 1500) -> list[float]:
    """Decode to mono 8 kHz s16 and reduce to `bins` normalized peak values (0..1)."""
    code, pcm, _ = await _run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], 120
    )
    if code != 0 or not pcm:
        raise MediaError("invalid_media", "Couldn't decode audio for the waveform.")
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    n = len(samples)
    step = max(1, n // bins)
    peaks = [max(abs(v) for v in samples[i : i + step]) / 32768 for i in range(0, n, step)][:bins]
    top = max(peaks) or 1
    return [round(p / top, 4) for p in peaks]
