import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app import main
from app.audio import lyrics
from app.core import safe_fetch
from app.rendering.service import RenderError, validate_project
from app.storage.assets import AssetStore

SID = "a" * 32
LRC = "[00:01.00] before\n[00:10.50] first\n[00:14.00] second\n[00:20.00]\n[00:30.00] after"


def test_parse_lrc_clips_and_shifts():
    # snippet = 10s..25s of the track
    assert lyrics.parse_lrc(LRC, 10_000, 25_000) == [
        {"startMs": 0, "endMs": 500, "text": "before"},  # already sounding when the snippet starts
        {"startMs": 500, "endMs": 4000, "text": "first"},
        {"startMs": 4000, "endMs": 10_000, "text": "second"},
    ]


@pytest.fixture
def client(tmp_path, monkeypatch):
    async def ok(url):
        return None

    monkeypatch.setattr(safe_fetch, "assert_public_url", ok)
    store = AssetStore(tmp_path)
    monkeypatch.setattr(main, "store", store)
    from app.storage.assets import Asset

    store.save_meta(Asset(id=SID, kind="audio", origin="upload", filename="s1.m4a", mime="audio/mp4", size=1,
                          duration_ms=15000, codec="aac", title=None, created_at=store.now()))
    return TestClient(main.app)


BODY = {"title": "T", "artist": "A", "duration_ms": 200000, "start_ms": 10000, "end_ms": 25000, "snippet_asset_id": SID}


@respx.mock
def test_route_uses_lrclib(client):
    respx.get(url__startswith=f"{lyrics.LRCLIB}/get").mock(return_value=httpx.Response(200, json={"syncedLyrics": LRC}))
    r = client.post("/api/v1/audio/lyrics", json=BODY).json()
    assert r["source"] == "lrclib" and [x["text"] for x in r["lines"]] == ["before", "first", "second"]


@respx.mock
def test_route_falls_back_to_whisper(client, monkeypatch):
    respx.get(url__startswith=f"{lyrics.LRCLIB}/get").mock(return_value=httpx.Response(404))
    monkeypatch.setattr(main, "cached_whisper", lambda *a: [{"startMs": 0, "endMs": 1000, "text": "la"}])
    assert client.post("/api/v1/audio/lyrics", json=BODY).json() == {"lines": [{"startMs": 0, "endMs": 1000, "text": "la"}], "source": "whisper"}


def test_validate_rejects_bad_lyrics(tmp_path):
    base = {"schemaVersion": 1, "canvas": {"aspect": "9:16", "fps": 30}, "elements": [], "fallbackDurationMs": 10000,
            "audio": {"snippet": None, "snippetAssetId": None}}
    store, s = AssetStore(tmp_path), main.settings
    validate_project({**base, "lyrics": {"lines": [{"startMs": 0, "endMs": 5, "text": "x"}]}}, store, s)
    for bad in ([{"startMs": 9, "endMs": 5, "text": "x"}], [{"startMs": 0, "endMs": 5, "text": "x" * 201}], [{"startMs": 0, "endMs": 1, "text": "x"}] * 301):
        with pytest.raises(RenderError):
            validate_project({**base, "lyrics": {"lines": bad}}, store, s)


@respx.mock
def test_route_says_so_when_lrclib_is_down(client, monkeypatch):
    monkeypatch.setattr(lyrics.asyncio, "sleep", lambda _: _noop())
    respx.get(url__startswith=f"{lyrics.LRCLIB}/get").mock(return_value=httpx.Response(503))
    respx.get(url__startswith=f"{lyrics.LRCLIB}/search").mock(return_value=httpx.Response(503))
    r = client.post("/api/v1/audio/lyrics", json=BODY)
    assert r.status_code == 502 and "busy" in r.json()["detail"]["error"]["message"]


async def _noop():
    return None


def _r(name, artist, dur, synced=True):
    return {"trackName": name, "artistName": artist, "duration": dur, "syncedLyrics": LRC if synced else None}


def test_best_match_picks_same_song_closest_duration():
    res = [_r("Song (Karaoke)", "Karaoke Hits", 200), _r("Song", "Band", 260), _r("Song", "Band", 201), _r("Song", "Band", 200, synced=False)]
    assert lyrics.best_match(res, "Song", "Band", 200_000) is res[2]
    assert lyrics.best_match(res, "Song", "Band", 100_000) is None  # nothing near that length
    assert lyrics.best_match([_r("Other", "Band", 200)], "Song", "Band", 200_000) is None


@respx.mock
def test_route_finds_via_search_when_exact_lookup_misses(client):
    respx.get(url__startswith=f"{lyrics.LRCLIB}/get").mock(return_value=httpx.Response(404))
    respx.get(url__startswith=f"{lyrics.LRCLIB}/search").mock(return_value=httpx.Response(200, json=[_r("T", "A", 200)]))
    r = client.post("/api/v1/audio/lyrics", json={**BODY, "duration_ms": 199000}).json()
    assert r["source"] == "lrclib" and r["lines"][0]["text"] == "before"
