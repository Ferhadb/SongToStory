"""Synced lyrics for a snippet: LRCLIB first (free, accurate), local Whisper when it has nothing. Times are snippet-relative ms."""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlencode

from rapidfuzz import fuzz

from app.audio.media import MediaError
from app.core.safe_fetch import safe_get
from app.matching.ranker import norm

LRCLIB = "https://lrclib.net/api"
_LRC = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")
MAX_LINES = 300
MAX_DURATION_OFF_S = 8
_model = None


def parse_lrc(lrc: str, start_ms: int, end_ms: int) -> list[dict]:
    """Keep the lines inside [start_ms, end_ms) and shift them so the snippet starts at 0. A line ends where the next begins."""
    stamps = []
    for raw in lrc.splitlines():
        m = _LRC.match(raw.strip())
        if m:
            stamps.append((round((int(m[1]) * 60 + float(m[2])) * 1000), m[3].strip()))
    stamps.sort(key=lambda s: s[0])
    out = []
    for i, (t, text) in enumerate(stamps):
        nxt = stamps[i + 1][0] if i + 1 < len(stamps) else end_ms
        if text and t < end_ms and nxt > start_ms:
            out.append({"startMs": max(t, start_ms) - start_ms, "endMs": min(nxt, end_ms) - start_ms, "text": text[:200]})
    return out[:MAX_LINES]


async def _lrclib(path: str, q: dict[str, str]) -> list | dict | None:
    """JSON from LRCLIB; None when it errors, [] / {} when it has nothing. Retries once since it answers 503 "busy" now and then."""
    for _ in range(2):
        try:
            resp = await safe_get(f"{LRCLIB}/{path}?{urlencode(q)}", headers={"User-Agent": "MusicStoryStudio"})
        except Exception:  # noqa: BLE001 - offline or blocked
            resp = None
        if resp is not None and resp.status_code < 500:
            return resp.json() if resp.status_code == 200 else {}
        await asyncio.sleep(1)
    return None


def best_match(results: list[dict], title: str, artist: str, duration_ms: int | None) -> dict | None:
    """The synced result that is the same song (title and artist alike) with the closest duration; covers, karaoke and re-uploads are rejected."""
    good = []
    for r in results:
        if not r.get("syncedLyrics"):
            continue
        t = fuzz.ratio(norm(title), norm(r.get("trackName") or ""))
        a = fuzz.token_set_ratio(norm(artist), norm(r.get("artistName") or "")) if artist else 100
        off = abs((r.get("duration") or 0) - duration_ms / 1000) if duration_ms else 0
        if t >= 85 and a >= 85 and off <= MAX_DURATION_OFF_S:
            good.append((off, -t, r))
    return min(good, key=lambda g: g[:2])[2] if good else None


async def fetch_lrclib(title: str, artist: str, duration_ms: int | None, start_ms: int, end_ms: int) -> list[dict] | None:
    """Synced lines, [] when LRCLIB has none, None when the service itself is down (so the caller can say so)."""
    q = {"track_name": title, "artist_name": artist}
    exact = await _lrclib("get", {**q, **({"duration": str(round(duration_ms / 1000))} if duration_ms else {})})
    if isinstance(exact, dict) and exact.get("syncedLyrics"):
        return parse_lrc(exact["syncedLyrics"], start_ms, end_ms)
    found = await _lrclib("search", q)  # tolerant of punctuation, remasters and small duration differences
    if found is None and exact is None:
        return None
    hit = best_match(found if isinstance(found, list) else [], title, artist, duration_ms)
    return parse_lrc(hit["syncedLyrics"], start_ms, end_ms) if hit else []


def whisper_lines(path: Path) -> list[dict]:
    global _model
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise MediaError("lyrics_unavailable", "No synced lyrics found, and speech recognition isn't installed on this server.") from e
    _model = _model or WhisperModel("base", device="cpu", compute_type="int8")
    segments, _ = _model.transcribe(str(path), vad_filter=True)
    return [
        {"startMs": round(s.start * 1000), "endMs": round(s.end * 1000), "text": s.text.strip()[:200]}
        for s in segments
        if s.text.strip()
    ][:MAX_LINES]


def cached_whisper(path: Path, asset_id: str, cache_dir: Path) -> list[dict]:
    f = cache_dir / f"{asset_id}.json"
    if f.exists():
        return json.loads(f.read_text())
    lines = whisper_lines(path)
    cache_dir.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(lines))
    return lines
