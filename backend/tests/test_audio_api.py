import subprocess

import pytest
from fastapi.testclient import TestClient

from app import main
from app.audio.media import sniff_audio
from app.storage.assets import AssetStore


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", AssetStore(tmp_path))
    return TestClient(main.app)


def make_audio(path, fmt_args, seconds=2):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", *fmt_args, str(path)],
        check=True,
    )
    return path


@pytest.mark.parametrize("name,args", [("a.wav", []), ("a.mp3", []), ("a.m4a", []), ("a.flac", []), ("a.ogg", ["-c:a", "libopus"])])
def test_upload_formats_and_waveform(client, tmp_path, name, args):
    p = make_audio(tmp_path / name, args)
    with p.open("rb") as f:
        r = client.post("/api/v1/uploads/audio", files={"file": (name, f)})
    assert r.status_code == 200, r.text
    a = r.json()
    assert 1800 <= a["duration_ms"] <= 2300 and a["origin"] == "upload"
    w = client.get(f"/api/v1/assets/{a['id']}/waveform?bins=200").json()
    assert 100 <= len(w["peaks"]) <= 200 and max(w["peaks"]) == 1.0
    s = client.get(f"/api/v1/assets/{a['id']}/stream", headers={"Range": "bytes=0-99"})
    assert s.status_code == 206


def test_upload_rejects_garbage_and_disguised(client):
    r = client.post("/api/v1/uploads/audio", files={"file": ("x.mp3", b"not audio at all, just text")})
    assert r.status_code == 422 and r.json()["detail"]["error"]["code"] == "unsupported_format"
    # right magic bytes, undecodable body
    r = client.post("/api/v1/uploads/audio", files={"file": ("x.wav", b"RIFF\x00\x00\x00\x00WAVEjunkjunk")})
    assert r.status_code == 422 and r.json()["detail"]["error"]["code"] == "invalid_media"


def test_upload_too_large(client, monkeypatch):
    monkeypatch.setattr(main.settings, "max_upload_bytes", 100)
    r = client.post("/api/v1/uploads/audio", files={"file": ("x.wav", b"RIFF\x00\x00\x00\x00WAVE" + b"0" * 500)})
    assert r.status_code == 413
    assert not list((main.store.root).glob(".upload-*"))  # temp cleaned


def test_asset_id_traversal_and_missing(client):
    assert client.get("/api/v1/assets/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/api/v1/assets/" + "0" * 32).status_code == 404


def test_acquire_rejects_non_youtube(client):
    r = client.post("/api/v1/audio/youtube", json={"url": "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"})
    assert r.status_code == 422 and r.json()["detail"]["error"]["code"] == "invalid_url"
    assert client.post("/api/v1/audio/youtube", json={"video_id": "x; rm -rf /"}).status_code == 422


def test_sniff():
    assert sniff_audio(b"ID3\x04" + b"0" * 12) == "mp3"
    assert sniff_audio(b"\xff\xf1" + b"0" * 14) == "aac"
    assert sniff_audio(b"MZ\x90\x00" + b"0" * 12) is None
