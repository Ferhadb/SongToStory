"""Audio orchestration: candidates, acquisition (yt-dlp), uploads. One place that makes Assets."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import UploadFile

from app.audio import youtube
from app.audio.media import MediaError, probe_audio, sniff_audio
from app.audio.processing import SnippetSpec, render_snippet
from app.core.config import Settings
from app.matching.ranker import Ranked, Target, rank
from app.schemas.track import Platform, Track
from app.storage.assets import Asset, AssetStore


async def find_candidates(track: Track, settings: Settings) -> list[Ranked]:
    artists = [a.name for a in track.artists]
    cands = await youtube.search(youtube.build_queries(track.title, artists), settings)
    return rank(cands, Target(track.title, artists, track.duration_ms))


async def _register(store: AssetStore, src: Path, ext: str, origin: str, title: str | None, s: Settings) -> Asset:
    info = await probe_audio(src, s.max_audio_seconds)
    aid = store.new_id()
    dest = store.blob_path(aid, ext)
    shutil.move(src, dest)
    mime = {"m4a": "audio/mp4", "mp3": "audio/mpeg", "wav": "audio/wav", "flac": "audio/flac",
            "ogg": "audio/ogg", "aac": "audio/aac"}[ext]
    return store.save_meta(Asset(
        id=aid, kind="audio", origin=origin, filename=dest.name, mime=mime, size=dest.stat().st_size,
        duration_ms=info["duration_ms"], codec=info["codec"], title=title, created_at=store.now(),
    ))


async def acquire_youtube(video_id: str, store: AssetStore, s: Settings) -> Asset:
    cand = await youtube.video_info(video_id)
    path, tmp = await youtube.download_audio(video_id, s)
    try:
        return await _register(store, path, "m4a", "youtube", cand.title, s)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def save_upload(file: UploadFile, store: AssetStore, s: Settings) -> Asset:
    head = await file.read(16)
    kind = sniff_audio(head)
    if kind is None:
        raise MediaError("unsupported_format", "Unsupported file. Use MP3, WAV, M4A, AAC, FLAC or OGG.")
    tmp = store.root / f".upload-{store.new_id()}"
    size = len(head)
    try:
        with tmp.open("wb") as f:
            f.write(head)
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > s.max_upload_bytes:
                    raise MediaError("too_large", f"File is larger than {s.max_upload_bytes // 1024 // 1024} MB.")
                f.write(chunk)
        title = Path(file.filename or "upload").stem[:120]
        return await _register(store, tmp, kind, "upload", title, s)
    finally:
        tmp.unlink(missing_ok=True)


def platform_is_youtube(p: Platform) -> bool:
    return p in (Platform.YOUTUBE, Platform.YOUTUBE_MUSIC)


async def make_snippet(spec: SnippetSpec, store: AssetStore, s: Settings) -> Asset:
    src = store.get(spec.asset_id)
    if not src or src.kind != "audio":
        raise MediaError("not_found", "Source audio not found.")
    aid = store.new_id()
    dest = store.blob_path(aid, "m4a")
    await render_snippet(store.path_of(src), dest, spec, src.duration_ms)
    info = await probe_audio(dest, s.max_audio_seconds)
    return store.save_meta(Asset(
        id=aid, kind="audio", origin="snippet", filename=dest.name, mime="audio/mp4", size=dest.stat().st_size,
        duration_ms=info["duration_ms"], codec=info["codec"], title=f"{src.title or 'Audio'} (snippet)",
        created_at=store.now(),
    ))
