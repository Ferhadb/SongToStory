"""Render jobs: validate a project, run the Node/Remotion renderer, verify the MP4 with ffprobe."""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import shutil
import unicodedata
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.audio.analysis import analyze_file
from app.audio.media import MediaError, _run
from app.core.config import Settings
from app.rendering.db import RenderDB
from app.storage.assets import AssetStore

ASPECTS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350), "16:9": (1920, 1080)}
# Quality presets: Remotion `scale` and x264 CRF.
QUALITY = {"draft": (0.5, 28), "standard": (1.0, 20), "high": (1.0, 16)}
TERMINAL = {"completed", "failed", "cancelled"}


class RenderError(Exception):
    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def safe_filename(artist: str, title: str) -> str:
    """ASCII-safe-ish download name that keeps Cyrillic etc. but drops path/control characters."""
    raw = f"{artist} - {title}".strip(" -") or "story"
    raw = unicodedata.normalize("NFC", raw)
    raw = re.sub(r"[\x00-\x1f\x7f/\\:*?\"<>|]+", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip(" .")
    return (raw[:80].rstrip(" .") or "story") + ".mp4"


def _image_asset(store: AssetStore, aid: object, code: str, what: str) -> None:
    """The referenced asset must exist and be an image; the messages say which picture and what to do."""
    a = store.get(aid) if isinstance(aid, str) else None
    if a is None:
        raise RenderError(code, f"{what} is no longer on the server. Upload it again.")
    if a.kind != "image":
        raise RenderError("invalid_photo" if code == "missing_photo" else "invalid_media", f"{what} isn't an image. Choose a picture instead.")


def _check_photo_media(p: dict, store: AssetStore) -> None:
    """Photo Story media: the background photo, its crop, and any artwork chosen just for the player card."""
    if (p.get("background") or {}).get("type") == "photo":
        ph = p.get("photo")
        if not isinstance(ph, dict) or not ph.get("assetId"):
            raise RenderError("missing_photo", "Add a photo to this story before exporting.")
        for k, lo, hi in (("zoom", 1, 4), ("focusX", 0, 1), ("focusY", 0, 1), ("dim", 0, 0.85)):
            v = ph.get(k)
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not lo <= v <= hi:
                raise RenderError("invalid_project", "The photo's crop settings are invalid.")
        _image_asset(store, ph["assetId"], "missing_photo", "The photo used by this story")
    for e in p["elements"]:
        art = (e.get("player") or {}).get("artwork") if e.get("visible", True) else None
        if art:
            _image_asset(store, art.get("assetId") if isinstance(art, dict) else None, "missing_media", "The artwork on the player card")


def validate_project(p: dict, store: AssetStore, s: Settings) -> tuple[int, int, int]:
    """Cheap structural checks (the renderer re-validates by rendering). Returns (w, h, duration_ms)."""
    try:
        if p.get("schemaVersion") != 1:
            raise RenderError("invalid_project", "Unsupported project version.")
        aspect = p["canvas"]["aspect"]
        fps = p["canvas"]["fps"]
        if aspect not in ASPECTS or not isinstance(fps, int) or not 15 <= fps <= 60:
            raise RenderError("invalid_project", "Unsupported canvas settings.")
        elements = p["elements"]
        if not isinstance(elements, list) or len(elements) > 60:
            raise RenderError("invalid_project", "Too many elements.")
        for e in elements:
            for k in ("x", "y", "w", "h"):
                if not isinstance(e[k], (int, float)) or abs(e[k]) > 20000:
                    raise RenderError("invalid_project", "An element has invalid geometry.")
            if len(str(e.get("content") or "")) > 500:
                raise RenderError("invalid_project", "Text is too long.")
        lines = (p.get("lyrics") or {}).get("lines", [])
        if not isinstance(lines, list) or len(lines) > 300:
            raise RenderError("invalid_project", "Too many lyric lines.")
        for ln in lines:
            if len(str(ln["text"])) > 200 or not 0 <= ln["startMs"] <= ln["endMs"]:
                raise RenderError("invalid_project", "A lyric line is invalid.")
        sn = p["audio"].get("snippet")
        dur_ms = int(sn["endMs"] - sn["startMs"]) if sn else int(p["fallbackDurationMs"])
        if dur_ms < 1000 or dur_ms > s.render_max_seconds * 1000:
            raise RenderError("invalid_project", f"Story length must be between 1s and {s.render_max_seconds}s.")
        ids = [p["audio"].get("snippetAssetId"), (p.get("artwork") or {}).get("assetId")]
        for aid in filter(None, ids):
            if not isinstance(aid, str) or store.get(aid) is None:
                raise RenderError("missing_media", "A media file used by this story is no longer on the server. Re-add the cover or audio.")
        _check_photo_media(p, store)
    except (KeyError, TypeError) as e:
        raise RenderError("invalid_project", "The project data is incomplete.") from e
    w, h = ASPECTS[aspect]
    return w, h, dur_ms


async def probe_video(path: Path) -> dict:
    code, out, _ = await _run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], 30
    )
    if code != 0:
        raise MediaError("invalid_media", "The rendered file could not be read.")
    return json.loads(out)


def needs_analysis(project: dict) -> bool:
    """True when a visible element reads the audio spectrum (visualizer, or a pulsing cover)."""
    if not project["audio"].get("snippetAssetId"):
        return False
    return any(
        e.get("visible", True) and (e.get("type") == "visualizer" or (e.get("reactive") or 0) > 0)
        for e in project["elements"]
    )


class RenderManager:
    def __init__(self, settings: Settings, store: AssetStore):
        self.s, self.store = settings, store
        self.root = settings.data_dir.resolve() / "renders"
        self.db = RenderDB(settings.data_dir.resolve() / "renders.db")
        self._sem = asyncio.Semaphore(1)
        self._procs: dict[str, asyncio.subprocess.Process] = {}
        self._cancelled: set[str] = set()
        self._tasks: set[asyncio.Task] = set()

    def path_of(self, id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", id):
            raise RenderError("not_found", "Export not found.", 404)
        return self.root / id / "story.mp4"

    def submit(self, project: dict, quality: str) -> dict:
        if quality not in QUALITY:
            raise RenderError("invalid_settings", "Unknown quality preset.")
        w, h, dur = validate_project(project, self.store, self.s)
        t = project.get("track") or {}
        title = str(t.get("title") or "Untitled")[:200]
        artists = t.get("artists") or []
        artist = str(artists[0]) if artists else ""
        id = uuid.uuid4().hex
        scale = QUALITY[quality][0]
        d = self.root / id
        d.mkdir(parents=True)
        job = {
            "project": project, "assetBase": self.s.render_asset_base, "outPath": str(d / "story.mp4"),
            "scale": scale, "crf": QUALITY[quality][1],
            "cacheDir": str(self.s.data_dir.resolve() / "renderer-cache"),
        }
        (d / "job.json").write_text(json.dumps(job))
        self.db.insert({
            "id": id, "status": "queued", "progress": 0, "title": title,
            "filename": safe_filename(artist, title), "quality": quality,
            "width": int(w * scale), "height": int(h * scale), "duration_ms": dur,
            "created_at": datetime.now(UTC).isoformat(),
        })
        task = asyncio.create_task(self._run(id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return self.db.get(id)  # type: ignore[return-value]

    def _fail(self, id: str, code: str, message: str) -> None:
        self.db.update(id, status="failed", error_code=code, error_message=message,
                       finished_at=datetime.now(UTC).isoformat())

    async def _run(self, id: str) -> None:
        async with self._sem:
            if id in self._cancelled:
                return
            d = self.root / id
            self.db.update(id, status="preparing")
            try:
                await self._attach_analysis(d)
            except MediaError as e:
                self._fail(id, "analysis_failed", e.message)
                return
            try:
                proc = await asyncio.create_subprocess_exec(
                    self.s.node_bin, "render.mjs", str(d / "job.json"),
                    cwd=self.s.renderer_dir.resolve(), stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                )
            except FileNotFoundError:
                self._fail(id, "renderer_unavailable", "Node.js was not found, so the renderer can't start.")
                return
            self._procs[id] = proc
            err_task = asyncio.create_task(proc.stderr.read())  # type: ignore[union-attr]
            last_error = ""
            try:
                async with asyncio.timeout(self.s.render_timeout_s):
                    assert proc.stdout
                    async for line in proc.stdout:
                        try:
                            ev = json.loads(line)
                        except ValueError:
                            continue
                        stage = ev.get("stage")
                        if stage == "error":
                            last_error = ev.get("message", "")
                        elif stage in ("preparing", "rendering", "encoding", "finalizing", "bundling"):
                            self.db.update(id, status="preparing" if stage == "bundling" else stage,
                                           progress=float(ev.get("progress") or 0))
                    await proc.wait()
            except TimeoutError:
                proc.kill()
                self._fail(id, "timeout", "The export took too long and was stopped. Try a shorter clip or Draft quality.")
                return
            finally:
                self._procs.pop(id, None)
                stderr = (await err_task).decode("utf8", "replace")
            if id in self._cancelled:
                self.db.update(id, status="cancelled", finished_at=datetime.now(UTC).isoformat())
                return
            if proc.returncode != 0:
                self._fail(id, *self._classify(last_error or stderr))
                return
            await self._verify(id)

    async def _attach_analysis(self, d: Path) -> None:
        """Bake the audio spectrum into the job so the renderer needs no network access for it."""
        job = json.loads((d / "job.json").read_text())
        p = job["project"]
        if not needs_analysis(p):
            return
        a = self.store.get(p["audio"]["snippetAssetId"])
        if a is None:
            raise MediaError("not_found", "The audio file is gone.")
        job["analysis"] = await analyze_file(self.store.path_of(a), p["canvas"]["fps"], 64, self.s.data_dir.resolve() / "analysis")
        (d / "job.json").write_text(json.dumps(job))

    @staticmethod
    def _classify(msg: str) -> tuple[str, str]:
        m = msg.lower()
        if "browser" in m and ("not found" in m or "download" in m or "executable" in m):
            return "browser_missing", "No Chrome/Chromium browser was found for rendering. Install Google Chrome or set CHROME_PATH."
        if "out of memory" in m or "enomem" in m:
            return "out_of_memory", "The export ran out of memory. Try Draft quality or a shorter clip."
        if "404" in m or "failed to load" in m or "net::err" in m:
            return "missing_media", "The renderer couldn't load a cover or audio file from the server."
        return "render_failed", "The export failed. " + (msg.strip().splitlines()[-1][:300] if msg.strip() else "")

    async def _verify(self, id: str) -> None:
        row = self.db.get(id)
        assert row
        path = self.path_of(id)
        try:
            info = await probe_video(path)
            v = next((x for x in info["streams"] if x["codec_type"] == "video"), None)
            if not v or v["codec_name"] != "h264":
                raise MediaError("invalid_media", "The rendered file isn't H.264 video.")
            dur = float(info["format"]["duration"]) * 1000
            if abs(dur - row["duration_ms"]) > 400:
                raise MediaError("invalid_media", f"The rendered video is {dur / 1000:.1f}s, expected {row['duration_ms'] / 1000:.1f}s.")
            self.db.update(id, status="completed", progress=1, width=int(v["width"]), height=int(v["height"]),
                           duration_ms=int(dur), size_bytes=path.stat().st_size,
                           finished_at=datetime.now(UTC).isoformat())
        except (MediaError, OSError, KeyError, ValueError) as e:
            self._fail(id, "invalid_output", str(getattr(e, "message", e)))

    def cancel(self, id: str) -> dict:
        row = self.db.get(id)
        if not row:
            raise RenderError("not_found", "Export not found.", 404)
        if row["status"] in TERMINAL:
            return row
        self._cancelled.add(id)
        proc = self._procs.get(id)
        if proc:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
        else:
            self.db.update(id, status="cancelled", finished_at=datetime.now(UTC).isoformat())
        return self.db.get(id)  # type: ignore[return-value]

    def delete(self, id: str) -> None:
        row = self.db.get(id)
        if not row:
            raise RenderError("not_found", "Export not found.", 404)
        if row["status"] not in TERMINAL:
            raise RenderError("busy", "Cancel the export before deleting it.", 409)
        shutil.rmtree(self.root / id, ignore_errors=True)
        self.db.delete(id)
