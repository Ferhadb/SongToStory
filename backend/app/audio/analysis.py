"""Per-frame audio analysis for audio-reactive visuals.

Decodes audio to mono PCM with ffmpeg, then computes, for every video frame, a log-spaced band spectrum
and an RMS level, quantized to uint8. The result is a pure function of (audio, fps, bands), so preview and
export read identical data.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np

from app.audio.media import MediaError, _run

SR = 22050
N_FFT = 2048
F_MIN, F_MAX = 40.0, 10000.0
DB_RANGE = 60.0  # dB below the track's loud peaks that maps to 0
TILT_DB_PER_OCT = 2.5  # music has less energy up high; lift highs so bars aren't all bass
MAX_FRAMES = 60 * 60 * 5


async def decode_mono(path: Path, timeout: int = 120) -> np.ndarray:
    code, out, _ = await _run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], timeout
    )
    if code != 0 or not out:
        raise MediaError("invalid_media", "That audio couldn't be analysed.")
    return np.frombuffer(out, dtype="<f4")


def band_edges(bands: int) -> np.ndarray:
    return np.geomspace(F_MIN, F_MAX, bands + 1)


def analyze_samples(x: np.ndarray, fps: int, bands: int) -> dict:
    hop = SR / fps
    frames = max(1, int(np.ceil(len(x) / hop)))
    if frames > MAX_FRAMES:
        raise MediaError("too_large", "That clip is too long to analyse.")
    pad = np.concatenate([np.zeros(N_FFT // 2, dtype=np.float32), x, np.zeros(N_FFT, dtype=np.float32)])
    win = np.hanning(N_FFT).astype(np.float32)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    edges = band_edges(bands)
    centers = np.sqrt(edges[:-1] * edges[1:])
    # bin range per band; narrow low bands still get at least one bin
    lo = np.searchsorted(freqs, edges[:-1], side="left")
    hi = np.maximum(np.searchsorted(freqs, edges[1:], side="left"), lo + 1)
    tilt = TILT_DB_PER_OCT * np.log2(centers / centers[0])

    spec = np.empty((frames, bands), dtype=np.float32)
    rms = np.empty(frames, dtype=np.float32)
    for start in range(0, frames, 512):
        idx = np.arange(start, min(frames, start + 512))
        centers_i = np.round(idx * hop + hop / 2).astype(int)
        seg = np.stack([pad[c : c + N_FFT] for c in centers_i])  # window centred on the frame time
        mag = np.abs(np.fft.rfft(seg * win, axis=1)) / (N_FFT / 4)
        for b in range(bands):
            spec[idx, b] = mag[:, lo[b] : hi[b]].max(axis=1)
        rms[idx] = np.sqrt((seg[:, N_FFT // 2 - int(hop) : N_FFT // 2 + int(hop)] ** 2).mean(axis=1))

    db = 20 * np.log10(spec + 1e-9) + tilt
    ref = float(np.percentile(db, 99)) if db.size else 0.0
    norm = np.clip((db - (ref - DB_RANGE)) / DB_RANGE, 0, 1)
    r_ref = float(np.percentile(rms, 99)) or 1.0
    r_norm = np.clip(rms / max(r_ref, 1e-6), 0, 1)
    if float(np.abs(x).max(initial=0)) < 1e-4:  # digital silence: don't amplify the noise floor
        norm[:] = 0
        r_norm[:] = 0
    data = np.concatenate([norm, r_norm[:, None]], axis=1)  # last column = RMS
    q = np.round(data * 255).astype(np.uint8)
    return {"fps": fps, "bands": bands, "frames": frames, "data": base64.b64encode(q.tobytes()).decode()}


async def analyze_file(path: Path, fps: int, bands: int, cache_dir: Path | None = None) -> dict:
    cache = None
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache = cache_dir / f"{path.stem}-{fps}-{bands}.json"
        if cache.exists() and cache.stat().st_mtime >= path.stat().st_mtime:
            return json.loads(cache.read_text())
    result = analyze_samples(await decode_mono(path), fps, bands)
    if cache is not None:
        cache.write_text(json.dumps(result))
    return result
