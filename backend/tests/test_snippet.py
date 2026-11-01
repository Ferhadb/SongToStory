import array
import subprocess

import pytest
from fastapi.testclient import TestClient

from app import main
from app.audio.processing import SnippetSpec, build_filter
from app.storage.assets import AssetStore


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", AssetStore(tmp_path))
    return TestClient(main.app)


@pytest.fixture
def source(client, tmp_path):
    p = tmp_path / "s.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", str(p)], check=True)
    with p.open("rb") as f:
        return client.post("/api/v1/uploads/audio", files={"file": ("s.wav", f)}).json()


def pcm(path, ss=0, t=None):
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-ss", str(ss)] + (["-t", str(t)] if t else []) + ["-ac", "1", "-ar", "8000", "-f", "s16le", "-"]
    out = subprocess.run(cmd, check=True, capture_output=True).stdout
    a = array.array("h")
    a.frombytes(out)
    return a


def test_duration_is_accurate(client, source):
    r = client.post("/api/v1/audio/snippet", json={"asset_id": source["id"], "start_ms": 2000, "end_ms": 7500})
    assert r.status_code == 200, r.text
    assert abs(r.json()["duration_ms"] - 5500) <= 60
    assert r.json()["origin"] == "snippet"


def test_fades_shape_the_audio(client, source):
    spec = {"asset_id": source["id"], "start_ms": 1000, "end_ms": 6000, "fade_in_ms": 2000, "fade_out_ms": 2000}
    a = client.post("/api/v1/audio/snippet", json=spec).json()
    samples = pcm(main.store.path_of(main.store.get(a["id"])))
    n = len(samples)
    peak = lambda seg: max(abs(v) for v in seg)
    assert peak(samples[: n // 50]) < 0.15 * peak(samples[n // 2 - 400 : n // 2 + 400])
    assert peak(samples[-n // 50 :]) < 0.15 * peak(samples[n // 2 - 400 : n // 2 + 400])


def test_gain_changes_level(client, source):
    loud = client.post("/api/v1/audio/snippet", json={"asset_id": source["id"], "start_ms": 0, "end_ms": 3000}).json()
    quiet = client.post("/api/v1/audio/snippet", json={"asset_id": source["id"], "start_ms": 0, "end_ms": 3000, "gain_db": -12}).json()
    pl = max(abs(v) for v in pcm(main.store.path_of(main.store.get(loud["id"]))))
    pq = max(abs(v) for v in pcm(main.store.path_of(main.store.get(quiet["id"]))))
    assert 0.2 < pq / pl < 0.32  # -12 dB ≈ 0.25


@pytest.mark.parametrize(
    "body",
    [
        {"start_ms": 0, "end_ms": 500},  # too short
        {"start_ms": 5000, "end_ms": 4000},
        {"start_ms": 0, "end_ms": 2000, "fade_in_ms": 1500, "fade_out_ms": 1500},
        {"start_ms": 0, "end_ms": 2000, "gain_db": 99},
        {"start_ms": 0, "end_ms": 2000, "fade_in_ms": -1},
        {"start_ms": 0, "end_ms": 10 * 60 * 1000},
    ],
)
def test_invalid_specs_rejected(client, source, body):
    assert client.post("/api/v1/audio/snippet", json={"asset_id": source["id"], **body}).status_code == 422


def test_past_end_and_unknown_asset(client, source):
    r = client.post("/api/v1/audio/snippet", json={"asset_id": source["id"], "start_ms": 10_000, "end_ms": 20_000})
    assert r.status_code == 422 and r.json()["detail"]["error"]["code"] == "out_of_range"
    r = client.post("/api/v1/audio/snippet", json={"asset_id": "0" * 32, "start_ms": 0, "end_ms": 2000})
    assert r.status_code == 404


def test_filter_chain():
    f = build_filter(SnippetSpec(asset_id="a", start_ms=0, end_ms=10_000, fade_in_ms=500, fade_out_ms=1000, gain_db=-3, normalize=True))
    assert f.startswith("atrim=start=0.000:end=10.000,asetpts=PTS-STARTPTS,volume=-3.0dB,loudnorm") and "afade=t=out:st=9.0:d=1.0" in f
