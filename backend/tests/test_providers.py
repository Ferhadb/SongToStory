import httpx
import pytest
import respx

from app.core import safe_fetch
from app.providers.base import ProviderError
from app.providers.link_parser import parse_link
from app.providers.registry import resolve


@pytest.fixture(autouse=True)
def no_dns(monkeypatch):
    async def ok(url):  # tests must not hit DNS
        return None

    monkeypatch.setattr(safe_fetch, "assert_public_url", ok)


@respx.mock
async def test_deezer_normalizes():
    respx.get("https://api.deezer.com/track/3135556").mock(
        return_value=httpx.Response(
            200,
            json={
                "title": "Холод",
                "duration": 180,
                "isrc": "XX1",
                "explicit_lyrics": True,
                "release_date": "2020-01-01",
                "album": {"title": "Alb", "cover_xl": "https://x/xl.jpg", "cover_big": "https://x/b.jpg"},
                "contributors": [{"name": "Kai Angel"}, {"name": "Feat"}],
                "artist": {"name": "Kai Angel"},
            },
        )
    )
    t = await resolve(parse_link("https://www.deezer.com/track/3135556"))
    assert t.title == "Холод" and t.duration_ms == 180000 and t.isrc == "XX1"
    assert [a.role for a in t.artists] == ["primary", "featured"]
    assert t.artwork.original.url.endswith("xl.jpg")


@respx.mock
async def test_deezer_not_found():
    respx.get("https://api.deezer.com/track/1").mock(
        return_value=httpx.Response(200, json={"error": {"type": "DataException"}})
    )
    with pytest.raises(ProviderError) as e:
        await resolve(parse_link("https://www.deezer.com/track/1"))
    assert e.value.code == "not_found"


@respx.mock
async def test_youtube_oembed_splits_artist_title():
    respx.get(url__startswith="https://www.youtube.com/oembed").mock(
        return_value=httpx.Response(
            200, json={"title": "Kai Angel - Холод", "author_name": "Chan", "thumbnail_url": "https://i/t.jpg"}
        )
    )
    t = await resolve(parse_link("https://youtu.be/dQw4w9WgXcQ"))
    assert (t.title, t.artists[0].name) == ("Холод", "Kai Angel")


@respx.mock
async def test_spotify_oembed_leaves_artist_empty():
    respx.get(url__startswith="https://open.spotify.com/oembed").mock(
        return_value=httpx.Response(200, json={"title": "Song", "thumbnail_url": "https://i/t.jpg"})
    )
    t = await resolve(parse_link("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"))
    assert t.artists == [] and t.title == "Song"


@respx.mock
async def test_spotify_artist_and_album_from_page_tags():
    respx.get(url__startswith="https://open.spotify.com/oembed").mock(
        return_value=httpx.Response(200, json={"title": "ХОЛОД", "thumbnail_url": "https://i/t.jpg"})
    )
    respx.get("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC").mock(
        return_value=httpx.Response(
            200,
            text='<meta property="og:description" content="Kai Angel · GOD SYSTEM · Song · 2024"/>'
                 '<meta name="music:musician_description" content="Kai Angel"/>',
        )
    )
    t = await resolve(parse_link("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"))
    assert [a.name for a in t.artists] == ["Kai Angel"] and t.album.name == "GOD SYSTEM"


@respx.mock
async def test_apple_big_artwork():
    respx.get(url__startswith="https://itunes.apple.com/lookup").mock(
        return_value=httpx.Response(
            200,
            json={"results": [{"wrapperType": "track", "trackName": "T", "artistName": "A",
                               "artworkUrl100": "https://i/100x100bb.jpg", "trackTimeMillis": 1000}]},
        )
    )
    t = await resolve(parse_link("https://music.apple.com/us/song/x/789"))
    assert "1200x1200bb" in t.artwork.original.url


@respx.mock
async def test_provider_down_is_retryable():
    respx.get("https://api.deezer.com/track/5").mock(return_value=httpx.Response(503))
    with pytest.raises(ProviderError) as e:
        await resolve(parse_link("https://www.deezer.com/track/5"))
    assert e.value.code == "provider_unavailable" and e.value.retryable
