import io

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.artwork.sources import find_artwork
from app.core import safe_fetch
from app.schemas.track import Artist, Artwork, ArtworkRef, Track, TrackSource
from app.storage.assets import AssetStore

MBID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", AssetStore(tmp_path))
    return TestClient(main.app)


@pytest.fixture
def no_dns(monkeypatch):
    async def ok(url):
        return None

    monkeypatch.setattr(safe_fetch, "assert_public_url", ok)


def img(fmt="PNG", size=(300, 300)):
    b = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(b, fmt)
    return b.getvalue()


def track(isrc="USRC17607839"):
    return Track(id="x", source=TrackSource(platform="deezer", url="https://x", external_id="1"),
                 title="Холод", artists=[Artist(name="Kai Angel")], isrc=isrc,
                 artwork=Artwork(original=ArtworkRef(url="https://orig/a.jpg", origin="deezer", verified=True)))


@pytest.mark.parametrize("fmt,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp"), ("GIF", "image/gif")])
def test_upload_keeps_original_bytes(client, fmt, mime):
    data = img(fmt)
    r = client.post("/api/v1/uploads/image", files={"file": ("c", data)})
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["mime"] == mime and (a["width"], a["height"]) == (300, 300)
    assert client.get(f"/api/v1/assets/{a['id']}/stream").content == data  # not recompressed


@pytest.mark.parametrize("data", [b"hello", img()[:200], img(size=(10, 10)), b"%PDF-1.4 " + b"0" * 100])
def test_upload_rejects(client, data):
    r = client.post("/api/v1/uploads/image", files={"file": ("c", data)})
    assert r.status_code == 422 and r.json()["detail"]["error"]["code"] in ("invalid_media", "unsupported_format")


def test_upload_too_large(client, monkeypatch):
    monkeypatch.setattr("app.artwork.images.MAX_IMAGE_BYTES", 1000)
    assert client.post("/api/v1/uploads/image", files={"file": ("c", img(size=(600, 600)))}).status_code == 413


@respx.mock
def test_import_remote(client, no_dns):
    respx.get("https://cdn.example.com/a.jpg").mock(return_value=httpx.Response(200, content=img("JPEG")))
    r = client.post("/api/v1/artwork/import", json={"url": "https://cdn.example.com/a.jpg"})
    assert r.status_code == 200 and r.json()["origin"] == "remote"


@respx.mock
def test_import_rejects_non_image_and_errors(client, no_dns):
    respx.get("https://cdn.example.com/page").mock(return_value=httpx.Response(200, content=b"<html>"))
    respx.get("https://cdn.example.com/gone").mock(return_value=httpx.Response(404))
    assert client.post("/api/v1/artwork/import", json={"url": "https://cdn.example.com/page"}).status_code == 422
    r = client.post("/api/v1/artwork/import", json={"url": "https://cdn.example.com/gone"})
    assert r.status_code == 422 and r.json()["detail"]["error"]["code"] == "fetch_failed"


def test_import_blocks_internal_urls(client):
    for u in ["https://169.254.169.254/latest/meta-data", "https://127.0.0.1/x.png", "http://example.com/x.png"]:
        r = client.post("/api/v1/artwork/import", json={"url": u})
        assert r.status_code == 422 and r.json()["detail"]["error"]["code"] == "fetch_failed"


@respx.mock
async def test_candidates_order_and_dedupe(no_dns):
    respx.get(url__startswith="https://musicbrainz.org/ws/2/isrc/").mock(return_value=httpx.Response(
        200, json={"recordings": [{"releases": [{"id": MBID, "title": "Alb"}]}]}))
    respx.get(url__startswith="https://itunes.apple.com/search").mock(return_value=httpx.Response(
        200, json={"results": [{"artworkUrl100": "https://i/100x100bb.jpg", "collectionName": "Alb"}]}))
    respx.get(url__startswith="https://api.deezer.com/search").mock(return_value=httpx.Response(
        200, json={"data": [{"album": {"cover_xl": "https://orig/a.jpg", "title": "Alb"}}]}))  # dup of original
    cands, warnings = await find_artwork(track())
    assert [c.origin for c in cands] == ["deezer", "musicbrainz", "apple_music"]
    assert [c.verified for c in cands] == [True, True, False]
    assert cands[1].url.endswith(f"{MBID}/front-1200") and "1200x1200bb" in cands[2].url
    assert warnings == []


@respx.mock
async def test_one_source_down_still_returns_others(no_dns):
    respx.get(url__startswith="https://musicbrainz.org").mock(return_value=httpx.Response(503))
    respx.get(url__startswith="https://itunes.apple.com").mock(return_value=httpx.Response(200, json={"results": []}))
    respx.get(url__startswith="https://api.deezer.com").mock(return_value=httpx.Response(200, json={"data": []}))
    cands, warnings = await find_artwork(track())
    assert len(cands) == 1 and warnings == ["musicbrainz unavailable"]


@respx.mock
async def test_no_isrc_skips_musicbrainz(no_dns):
    respx.get(url__startswith="https://itunes.apple.com").mock(return_value=httpx.Response(200, json={"results": []}))
    respx.get(url__startswith="https://api.deezer.com").mock(return_value=httpx.Response(200, json={"data": []}))
    _, warnings = await find_artwork(track(isrc=None))
    assert warnings == []
