import pytest

from app.providers.link_parser import LinkError, is_shortlink, parse_link
from app.schemas.track import MediaKind, Platform

SP = "4uLU6hMCjMI75M1A2tKUQC"


@pytest.mark.parametrize(
    "url,platform,kind,ext",
    [
        (f"https://open.spotify.com/track/{SP}?si=abc", Platform.SPOTIFY, MediaKind.TRACK, SP),
        (f"open.spotify.com/intl-ru/track/{SP}", Platform.SPOTIFY, MediaKind.TRACK, SP),
        ("https://youtu.be/dQw4w9WgXcQ?t=10", Platform.YOUTUBE, MediaKind.VIDEO, "dQw4w9WgXcQ"),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x", Platform.YOUTUBE, MediaKind.VIDEO, "dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", Platform.YOUTUBE, MediaKind.VIDEO, "dQw4w9WgXcQ"),
        ("https://music.youtube.com/watch?v=dQw4w9WgXcQ", Platform.YOUTUBE_MUSIC, MediaKind.VIDEO, "dQw4w9WgXcQ"),
        ("https://soundcloud.com/artist/some-track?utm=1", Platform.SOUNDCLOUD, MediaKind.TRACK, "artist/some-track"),
        ("https://www.deezer.com/en/track/3135556", Platform.DEEZER, MediaKind.TRACK, "3135556"),
        ("https://music.apple.com/us/album/x/123?i=456", Platform.APPLE_MUSIC, MediaKind.TRACK, "456"),
        ("https://music.apple.com/us/song/x/789", Platform.APPLE_MUSIC, MediaKind.TRACK, "789"),
        ("https://band.bandcamp.com/track/my-song", Platform.BANDCAMP, MediaKind.TRACK, "band/my-song"),
    ],
)
def test_recognizes(url, platform, kind, ext):
    p = parse_link(url)
    assert (p.platform, p.kind, p.external_id) == (platform, kind, ext)


@pytest.mark.parametrize(
    "url,code",
    [
        ("", "invalid_url"),
        ("ftp://open.spotify.com/track/x", "invalid_url"),
        ("https://user:pw@open.spotify.com/track/" + SP, "invalid_url"),
        ("https://open.spotify.com/track/short", "invalid_url"),
        ("https://youtube.com/watch?v=bad", "invalid_url"),
        ("https://example.com/track/1", "unsupported_platform"),
        ("https://evil.com/?u=open.spotify.com/track/" + SP, "unsupported_platform"),
        ("https://open.spotify.com.evil.com/track/" + SP, "unsupported_platform"),
        ("x" * 3000, "invalid_url"),
    ],
)
def test_rejects(url, code):
    with pytest.raises(LinkError) as e:
        parse_link(url)
    assert e.value.code == code


def test_shortlink():
    assert is_shortlink("https://spotify.link/abc")
    assert not is_shortlink("https://open.spotify.com/track/x")
