import asyncio
import json

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.artwork.images import save_image, save_photo
from app.artwork.sources import find_artwork
from app.audio import service as audio_service
from app.audio.analysis import analyze_file
from app.audio.media import MediaError, waveform_peaks
from app.audio.processing import SnippetSpec
from app.core.config import get_settings
from app.core.safe_fetch import safe_get
from app.providers.base import ProviderError
from app.providers.link_parser import LinkError, parse_link
from app.providers.registry import resolve
from app.rendering.service import TERMINAL, RenderError, RenderManager
from app.schemas.track import ParsedLink, Track
from app.storage.assets import AssetStore

app = FastAPI(title="Music Story Studio API", version="0.1.0")


class ResolveRequest(BaseModel):
    url: str


@app.get("/api/v1/health")
def health():
    return {"ok": True}


@app.post("/api/v1/detect", response_model=ParsedLink)
def detect(req: ResolveRequest):
    """Recognize a pasted URL (no network). Metadata resolution comes in the next milestone."""
    try:
        return parse_link(req.url)
    except LinkError as e:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=422,
            detail={"error": {"code": e.code, "message": e.message, "retryable": False}},
        ) from e


class ResolveResponse(BaseModel):
    link: ParsedLink
    track: Track
    warnings: list[str] = []


@app.post("/api/v1/resolve", response_model=ResolveResponse)
async def resolve_track(req: ResolveRequest):
    from fastapi import HTTPException

    try:
        link = parse_link(req.url)
        track = await resolve(link)
    except (LinkError, ProviderError) as e:
        status = 429 if e.code == "rate_limited" else 404 if e.code == "not_found" else 422
        if e.code == "provider_unavailable":
            status = 502
        raise HTTPException(
            status_code=status,
            detail={"error": {"code": e.code, "message": e.message, "retryable": getattr(e, "retryable", False)}},
        ) from e
    warnings = []
    if not track.artists:
        warnings.append("This service doesn't expose the artist name; you can enter it manually.")
    return ResolveResponse(link=link, track=track, warnings=warnings)


settings = get_settings()
store = AssetStore(settings.data_dir)
renders = RenderManager(settings, store)


def _media_http(e: MediaError) -> HTTPException:
    status = {"not_found": 404, "too_large": 413, "out_of_range": 422, "provider_unavailable": 502, "timeout": 504}.get(e.code, 422)
    return HTTPException(
        status_code=status,
        detail={"error": {"code": e.code, "message": e.message, "retryable": e.code in ("provider_unavailable", "timeout")}},
    )


class CandidatesRequest(BaseModel):
    track: Track


@app.post("/api/v1/audio/candidates")
async def audio_candidates(req: CandidatesRequest):
    """Ranked YouTube results with transparent score + reasons. Never auto-selects."""
    try:
        ranked = await audio_service.find_candidates(req.track, settings)
    except MediaError as e:
        raise _media_http(e) from e
    return {
        "candidates": [
            {
                "video_id": r.candidate.video_id, "title": r.candidate.title, "channel": r.candidate.channel,
                "duration_s": r.candidate.duration_s, "thumbnail": r.candidate.thumbnail, "url": r.candidate.url,
                "score": r.score, "reasons": r.reasons, "official_channel": r.official_channel,
            }
            for r in ranked
        ],
        "recommended": ranked[0].candidate.video_id if ranked and ranked[0].score >= 60 else None,
    }


class AcquireRequest(BaseModel):
    video_id: str | None = None
    url: str | None = None


@app.post("/api/v1/audio/youtube")
async def audio_acquire(req: AcquireRequest):
    """Download audio for a chosen YouTube video (by ID or pasted URL) into an asset."""
    try:
        vid = req.video_id
        if not vid and req.url:
            link = parse_link(req.url)
            if not audio_service.platform_is_youtube(link.platform):
                raise MediaError("invalid_url", "That isn't a YouTube link.")
            vid = link.external_id
        if not vid:
            raise MediaError("invalid_url", "Provide a video_id or a YouTube url.")
        return await audio_service.acquire_youtube(vid, store, settings)
    except LinkError as e:
        raise HTTPException(422, detail={"error": {"code": e.code, "message": e.message, "retryable": False}}) from e
    except MediaError as e:
        raise _media_http(e) from e


@app.post("/api/v1/uploads/audio")
async def upload_audio(file: UploadFile = File(...)):  # noqa: B008
    try:
        return await audio_service.save_upload(file, store, settings)
    except MediaError as e:
        raise _media_http(e) from e


def _asset_or_404(asset_id: str):
    a = store.get(asset_id)
    if not a:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Asset not found.", "retryable": False}})
    return a


@app.get("/api/v1/assets/{asset_id}")
def asset_meta(asset_id: str):
    return _asset_or_404(asset_id)


@app.get("/api/v1/assets/{asset_id}/stream")
def asset_stream(asset_id: str):
    a = _asset_or_404(asset_id)
    return FileResponse(store.path_of(a), media_type=a.mime)  # Starlette serves Range requests


@app.get("/api/v1/assets/{asset_id}/waveform")
async def asset_waveform(asset_id: str, bins: int = 1500):
    a = _asset_or_404(asset_id)
    try:
        return {"duration_ms": a.duration_ms, "peaks": await waveform_peaks(store.path_of(a), min(max(bins, 100), 6000))}
    except MediaError as e:
        raise _media_http(e) from e


@app.get("/api/v1/assets/{asset_id}/analysis")
async def asset_analysis(asset_id: str, fps: int = 30, bands: int = 64):
    """Per-frame band spectrum + RMS (uint8, base64) for audio-reactive visuals."""
    a = _asset_or_404(asset_id)
    if a.kind != "audio":
        raise HTTPException(422, detail={"error": {"code": "invalid_asset", "message": "Only audio can be analysed.", "retryable": False}})
    try:
        return await analyze_file(store.path_of(a), min(max(fps, 15), 60), min(max(bands, 8), 64), settings.data_dir / "analysis")
    except MediaError as e:
        raise _media_http(e) from e


@app.post("/api/v1/audio/snippet")
async def audio_snippet(spec: SnippetSpec):
    """Render the chosen interval (gain, loudnorm, fades) into a new audio asset."""
    try:
        return await audio_service.make_snippet(spec, store, settings)
    except MediaError as e:
        raise _media_http(e) from e


@app.post("/api/v1/artwork/candidates")
async def artwork_candidates(req: CandidatesRequest):
    """Original platform art first, then ISRC-verified (MusicBrainz), then search-based suggestions."""
    cands, warnings = await find_artwork(req.track)
    return {"candidates": cands, "warnings": warnings}


class ImportRequest(BaseModel):
    url: str


@app.post("/api/v1/artwork/import")
async def artwork_import(req: ImportRequest):
    """Fetch a remote image (SSRF-safe), validate it, and store a local copy as an asset."""
    try:
        resp = await safe_get(req.url, max_bytes=25 * 1024 * 1024, headers={"User-Agent": "MusicStoryStudio/0.1"})
    except Exception as e:
        raise HTTPException(422, detail={"error": {"code": "fetch_failed",
                            "message": "Couldn't download that image.", "retryable": True}}) from e
    if resp.status_code != 200:
        raise HTTPException(422, detail={"error": {"code": "fetch_failed",
                            "message": f"Image host returned {resp.status_code}.", "retryable": True}})
    try:
        return save_image(store, resp.content, "remote", None)
    except MediaError as e:
        raise _media_http(e) from e


@app.post("/api/v1/uploads/image")
async def upload_image(file: UploadFile = File(...)):  # noqa: B008
    data = await file.read(25 * 1024 * 1024 + 1)
    try:
        return save_image(store, data, "upload", (file.filename or "cover")[:120])
    except MediaError as e:
        raise _media_http(e) from e


@app.post("/api/v1/uploads/photo")
async def upload_photo(file: UploadFile = File(...)):  # noqa: B008
    """A personal photo for a Photo Story background (normalised: upright, sRGB, at most 4096px on the long side)."""
    data = await file.read(25 * 1024 * 1024 + 1)
    try:
        return await run_in_threadpool(save_photo, store, data, (file.filename or "photo")[:120])
    except MediaError as e:
        raise _media_http(e) from e


# ---------- exports ----------


def _render_http(e: RenderError) -> HTTPException:
    return HTTPException(status_code=e.status, detail={"error": {"code": e.code, "message": e.message, "retryable": False}})


class RenderRequest(BaseModel):
    project: dict
    quality: str = "standard"


def _public(row: dict) -> dict:
    return {k: v for k, v in row.items()}


@app.post("/api/v1/renders", status_code=202)
async def create_render(req: RenderRequest):
    try:
        return _public(renders.submit(req.project, req.quality))
    except RenderError as e:
        raise _render_http(e) from e


@app.get("/api/v1/renders")
def list_renders():
    return [_public(r) for r in renders.db.list()]


def _render_or_404(id: str) -> dict:
    row = renders.db.get(id)
    if not row:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Export not found.", "retryable": False}})
    return row


@app.get("/api/v1/renders/{render_id}")
def get_render(render_id: str):
    return _public(_render_or_404(render_id))


@app.get("/api/v1/renders/{render_id}/events")
async def render_events(render_id: str):
    """Server-sent events: a `progress` event whenever status/progress changes, then the stream ends."""
    _render_or_404(render_id)

    async def gen():
        last = None
        while True:
            row = renders.db.get(render_id)
            if row is None:
                return
            snap = (row["status"], round(row["progress"], 3))
            if snap != last:
                last = snap
                yield f"event: progress\ndata: {json.dumps(_public(row))}\n\n"
            if row["status"] in TERMINAL:
                return
            await asyncio.sleep(0.4)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@app.get("/api/v1/renders/{render_id}/download")
def download_render(render_id: str, inline: bool = False):
    row = _render_or_404(render_id)
    if row["status"] != "completed":
        raise HTTPException(409, detail={"error": {"code": "not_ready", "message": "This export isn't finished.", "retryable": True}})
    try:
        path = renders.path_of(render_id)
    except RenderError as e:
        raise _render_http(e) from e
    if not path.exists():
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "The file is gone. Export again.", "retryable": False}})
    if inline:
        return FileResponse(path, media_type="video/mp4")  # Range-capable, for the preview player
    return FileResponse(path, media_type="video/mp4", filename=row["filename"])


@app.post("/api/v1/renders/{render_id}/cancel")
async def cancel_render(render_id: str):
    try:
        return _public(renders.cancel(render_id))
    except RenderError as e:
        raise _render_http(e) from e


@app.delete("/api/v1/renders/{render_id}", status_code=204)
def delete_render(render_id: str):
    try:
        renders.delete(render_id)
    except RenderError as e:
        raise _render_http(e) from e
