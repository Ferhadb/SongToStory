"""Render job lifecycle with a fake renderer (a Python script standing in for render.mjs)."""

import asyncio
import json
import subprocess
import sys
import textwrap

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app
from app.rendering.service import RenderError, RenderManager, safe_filename, validate_project
from app.storage.assets import Asset, AssetStore

FAKE_OK = textwrap.dedent("""
    import json, subprocess, sys
    job = json.load(open(sys.argv[1]))
    print(json.dumps({"stage": "rendering", "progress": 0.5}), flush=True)
    subprocess.run(["ffmpeg","-v","error","-y","-f","lavfi","-i","color=c=blue:s=64x64:r=30:d=%s" % job["project"]["_secs"],
        "-f","lavfi","-i","sine=d=%s" % job["project"]["_secs"],"-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",job["outPath"]], check=True)
    print(json.dumps({"stage": "done", "progress": 1}), flush=True)
""")
FAKE_FAIL = "import json\nprint(json.dumps({'stage':'error','message':'net::ERR_CONNECTION_REFUSED loading cover'}), flush=True)\nraise SystemExit(1)\n"
FAKE_SLOW = "import time\ntime.sleep(30)\n"


def project(store: AssetStore, secs: int = 2) -> dict:
    img = store.save_meta(Asset(id=store.new_id(), kind="image", origin="upload", filename="x.png", mime="image/png", size=1, created_at="t"))
    return {
        "schemaVersion": 1, "_secs": secs,
        "track": {"title": "Холод", "artists": ["Kai Angel"]},
        "canvas": {"aspect": "9:16", "fps": 30},
        "elements": [{"x": 0, "y": 0, "w": 10, "h": 10}],
        "audio": {"snippet": {"startMs": 0, "endMs": secs * 1000}, "snippetAssetId": None},
        "artwork": {"assetId": img.id},
        "fallbackDurationMs": 15000,
    }


def manager(tmp_path, script: str) -> tuple[RenderManager, AssetStore]:
    rdir = tmp_path / "renderer"
    rdir.mkdir()
    (rdir / "render.mjs").write_text(script)
    s = Settings(data_dir=tmp_path / "data", renderer_dir=rdir, node_bin=sys.executable, render_timeout_s=20)
    store = AssetStore(s.data_dir)
    return RenderManager(s, store), store


async def wait_done(m: RenderManager, id: str) -> dict:
    for _ in range(200):
        row = m.db.get(id)
        if row["status"] in ("completed", "failed", "cancelled"):
            return row
        await asyncio.sleep(0.1)
    raise AssertionError("job did not finish")


def test_safe_filename():
    assert safe_filename("Kai Angel", "Холод") == "Kai Angel - Холод.mp4"
    assert safe_filename("A/B", "C:D*?") == "A B - C D.mp4"
    assert safe_filename("", "") == "story.mp4"
    assert ".." not in safe_filename("..", "..")
    assert len(safe_filename("x" * 300, "y")) <= 84


def test_validation_rejects_bad_projects(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    good = project(store)
    validate_project(good, store, m.s)
    for mutate, code in [
        (lambda p: p.update(schemaVersion=2), "invalid_project"),
        (lambda p: p["canvas"].update(aspect="3:2"), "invalid_project"),
        (lambda p: p["canvas"].update(fps=500), "invalid_project"),
        (lambda p: p.update(elements=[{"x": 1e9, "y": 0, "w": 1, "h": 1}]), "invalid_project"),
        (lambda p: p["audio"].update(snippet={"startMs": 0, "endMs": 10_000_000}), "invalid_project"),
        (lambda p: p["artwork"].update(assetId="f" * 32), "missing_media"),
        (lambda p: p.pop("canvas"), "invalid_project"),
    ]:
        bad = json.loads(json.dumps(good))
        mutate(bad)
        with pytest.raises(RenderError) as e:
            validate_project(bad, store, m.s)
        assert e.value.code == code


async def test_successful_render_is_verified(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    row = m.submit(project(store, 2), "draft")
    assert row["status"] == "queued" and row["filename"] == "Kai Angel - Холод.mp4"
    done = await wait_done(m, row["id"])
    assert done["status"] == "completed", done
    assert done["size_bytes"] > 0 and done["width"] == 64
    assert m.path_of(row["id"]).exists()


async def test_duration_mismatch_fails_verification(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    p = project(store, 2)
    p["_secs"] = 5  # renderer produces 5s but the project says 2s
    done = await wait_done(m, m.submit(p, "draft")["id"])
    assert done["status"] == "failed" and done["error_code"] == "invalid_output"


async def test_renderer_failure_is_classified(tmp_path):
    m, store = manager(tmp_path, FAKE_FAIL)
    done = await wait_done(m, m.submit(project(store), "standard")["id"])
    assert done["status"] == "failed" and done["error_code"] == "missing_media"


async def test_cancel_running_job(tmp_path):
    m, store = manager(tmp_path, FAKE_SLOW)
    row = m.submit(project(store), "draft")
    await asyncio.sleep(0.5)
    m.cancel(row["id"])
    done = await wait_done(m, row["id"])
    assert done["status"] == "cancelled"
    m.delete(row["id"])
    assert m.db.get(row["id"]) is None


async def test_missing_node_reports_unavailable(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    m.s.node_bin = "definitely-not-a-binary"
    done = await wait_done(m, m.submit(project(store), "draft")["id"])
    assert done["error_code"] == "renderer_unavailable"


def test_restart_marks_running_jobs_failed(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    m.db.insert({"id": "a" * 32, "status": "rendering", "progress": 0.3, "title": "t", "filename": "t.mp4", "quality": "draft", "created_at": "x"})
    m2 = RenderManager(m.s, store)
    assert m2.db.get("a" * 32)["error_code"] == "interrupted"


def test_endpoints_reject_bad_input():
    c = TestClient(app)
    r = c.post("/api/v1/renders", json={"project": {"schemaVersion": 9}, "quality": "standard"})
    assert r.status_code == 422 and r.json()["detail"]["error"]["code"] == "invalid_project"
    assert c.get("/api/v1/renders/" + "0" * 32).status_code == 404
    assert c.get("/api/v1/renders/../x/download").status_code in (404, 422)


def make_wav(path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=2", str(path)], check=True)


async def test_analysis_is_baked_into_job_when_needed(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    wav = store.save_meta(Asset(id=store.new_id(), kind="audio", origin="upload", filename="s.wav", mime="audio/wav", size=1, created_at="t"))
    make_wav(store.path_of(wav))
    p = project(store, 2)
    p["audio"]["snippetAssetId"] = wav.id
    p["elements"].append({"x": 0, "y": 0, "w": 10, "h": 10, "type": "visualizer", "visible": True})
    row = m.submit(p, "draft")
    await wait_done(m, row["id"])
    job = json.loads((m.root / row["id"] / "job.json").read_text())
    assert job["analysis"]["bands"] == 64 and job["analysis"]["frames"] >= 60
    plain = m.submit(project(store, 2), "draft")
    await wait_done(m, plain["id"])
    assert "analysis" not in json.loads((m.root / plain["id"] / "job.json").read_text())
