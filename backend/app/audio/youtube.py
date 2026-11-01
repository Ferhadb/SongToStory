"""YouTube discovery (search / video info) and audio download via yt-dlp.

The download is isolated here behind ENABLE_YTDLP. URLs are rebuilt from a validated 11-char
video ID, so no user-supplied string reaches the subprocess."""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import tempfile
from pathlib import Path

from app.audio.media import MediaError, _run
from app.core.config import Settings
from app.core.safe_fetch import safe_get
from app.matching.ranker import Candidate

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_ISO = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def watch_url(video_id: str) -> str:
    if not VIDEO_ID.match(video_id):
        raise MediaError("invalid_url", "Invalid YouTube video ID.")
    return f"https://www.youtube.com/watch?v={video_id}"


def _cand(vid: str, title: str, channel: str, dur: int | None) -> Candidate:
    return Candidate(
        video_id=vid, title=title, channel=channel, duration_s=dur,
        thumbnail=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", url=watch_url(vid),
    )


def build_queries(title: str, artists: list[str]) -> list[str]:
    base = f"{artists[0]} {title}".strip() if artists else title
    return [base, f"{base} official audio"]


async def _ytdlp_json(args: list[str], timeout: int) -> list[dict]:
    exe = shutil.which("yt-dlp")
    if not exe:
        raise MediaError("ytdlp_missing", "yt-dlp isn't installed.")
    code, out, _ = await _run([exe, "--no-warnings", "--ignore-config", *args], timeout)
    if code != 0 and not out:
        raise MediaError("provider_unavailable", "YouTube didn't respond. Try again or upload a file.")
    return [json.loads(line) for line in out.decode().splitlines() if line.strip()]


async def search(queries: list[str], settings: Settings, limit: int = 8) -> list[Candidate]:
    if settings.youtube_api_key:
        try:
            return await _search_api(queries, settings, limit)
        except Exception:  # noqa: BLE001, S110 - any API failure falls back to keyless search
            pass
    if not settings.enable_ytdlp:
        raise MediaError("search_unavailable", "Set YOUTUBE_API_KEY or enable yt-dlp to search YouTube.")
    results = await asyncio.gather(
        *[_ytdlp_json(["--flat-playlist", "--dump-json", f"ytsearch{limit}:{q}"], 45) for q in queries],
        return_exceptions=True,
    )
    cands, errs = [], 0
    for r in results:
        if isinstance(r, Exception):
            errs += 1
            continue
        for e in r:
            if e.get("id") and VIDEO_ID.match(e["id"]):
                dur = int(e["duration"]) if e.get("duration") else None
                cands.append(_cand(e["id"], e.get("title") or "", e.get("channel") or e.get("uploader") or "", dur))
    if not cands and errs:
        raise MediaError("provider_unavailable", "YouTube search failed. Try again or paste a link.")
    return cands


async def _search_api(queries: list[str], s: Settings, limit: int) -> list[Candidate]:
    from urllib.parse import quote

    ids: list[str] = []
    for q in queries:
        r = await safe_get(
            "https://www.googleapis.com/youtube/v3/search?part=id&type=video&maxResults="
            f"{limit}&q={quote(q)}&key={s.youtube_api_key}"
        )
        r.raise_for_status()
        ids += [i["id"]["videoId"] for i in r.json().get("items", [])]
    ids = list(dict.fromkeys(ids))
    if not ids:
        return []
    r = await safe_get(
        f"https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id={','.join(ids)}&key={s.youtube_api_key}"
    )
    r.raise_for_status()
    out = []
    for it in r.json().get("items", []):
        m = _ISO.fullmatch(it["contentDetails"]["duration"])
        h, mi, se = (int(x or 0) for x in m.groups()) if m else (0, 0, 0)
        out.append(_cand(it["id"], it["snippet"]["title"], it["snippet"]["channelTitle"], h * 3600 + mi * 60 + se))
    return out


async def video_info(video_id: str) -> Candidate:
    info = await _ytdlp_json(["--dump-json", "--no-playlist", "--skip-download", watch_url(video_id)], 45)
    if not info:
        raise MediaError("not_found", "That video wasn't found.")
    e = info[0]
    return _cand(video_id, e.get("title") or "", e.get("channel") or e.get("uploader") or "",
                 int(e["duration"]) if e.get("duration") else None)


async def download_audio(video_id: str, settings: Settings) -> tuple[Path, Path]:
    """Download best audio to a temp dir as m4a. Returns (file, tmpdir) — caller cleans up tmpdir."""
    if not settings.enable_ytdlp:
        raise MediaError("ytdlp_disabled", "YouTube audio download is turned off (ENABLE_YTDLP).")
    exe = shutil.which("yt-dlp")
    if not exe:
        raise MediaError("ytdlp_missing", "yt-dlp isn't installed.")
    tmp = Path(tempfile.mkdtemp(prefix="mss-dl-"))
    code, _, err = await _run(
        [exe, "--no-warnings", "--ignore-config", "--no-playlist", "-f", "bestaudio[ext=m4a]/bestaudio",
         "-x", "--audio-format", "m4a", "--audio-quality", "0",
         "--match-filter", f"duration < {settings.max_audio_seconds}",
         "--socket-timeout", "20", "--max-filesize", "200M",
         "-o", str(tmp / "%(id)s.%(ext)s"), "--", watch_url(video_id)],
        settings.ytdlp_timeout_s,
    )
    files = list(tmp.glob("*.m4a"))
    if code != 0 or not files:
        shutil.rmtree(tmp, ignore_errors=True)
        msg = err.decode(errors="ignore")
        if "Sign in" in msg or "age" in msg.lower():
            raise MediaError("restricted", "YouTube blocked this video (age/sign-in). Pick another or upload a file.")
        raise MediaError("download_failed", "Couldn't download that video's audio. Try another result or upload a file.")
    return files[0], tmp
