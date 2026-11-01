"""Pure URL recognition: no network. Maps a pasted URL to a ParsedLink."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

from app.schemas.track import MediaKind, ParsedLink, Platform

MAX_URL_LEN = 2048

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_SPOTIFY_ID = re.compile(r"^[A-Za-z0-9]{22}$")
_SEG = re.compile(r"^[A-Za-z0-9_.~%-]+$")


class LinkError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# Short-link hosts that need a (SSRF-safe) redirect resolve before parsing.
SHORTLINK_HOSTS = {"spotify.link", "on.soundcloud.com", "dzr.page.link", "link.deezer.com"}


def normalize_url(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw or len(raw) > MAX_URL_LEN:
        raise LinkError("invalid_url", "That doesn't look like a valid link.")
    if "://" not in raw:
        raw = "https://" + raw
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise LinkError("invalid_url", "Only http(s) links are supported.")
    if parts.username or parts.password:
        raise LinkError("invalid_url", "Links with credentials are not accepted.")
    return parts.geturl()


def _host(parts) -> str:
    h = (parts.hostname or "").lower().rstrip(".")
    return h.removeprefix("www.")


def is_shortlink(url: str) -> bool:
    return _host(urlsplit(url)) in SHORTLINK_HOSTS


def parse_link(raw: str) -> ParsedLink:
    url = normalize_url(raw)
    parts = urlsplit(url)
    host = _host(parts)
    segs = [s for s in parts.path.split("/") if s]
    qs = parse_qs(parts.query)

    if host in ("open.spotify.com", "play.spotify.com"):
        return _spotify(segs)
    if host in ("youtu.be",):
        return _youtube_id(segs[0] if segs else "", Platform.YOUTUBE)
    if host in ("youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"):
        platform = Platform.YOUTUBE_MUSIC if host == "music.youtube.com" else Platform.YOUTUBE
        return _youtube(segs, qs, platform)
    if host == "soundcloud.com" or host == "m.soundcloud.com":
        return _soundcloud(segs)
    if host in ("deezer.com", "deezer.page.link") or host.endswith(".deezer.com"):
        return _deezer(segs)
    if host == "music.apple.com" or host == "itunes.apple.com":
        return _apple(segs, qs)
    if host.endswith(".bandcamp.com"):
        return _bandcamp(host, segs)
    raise LinkError("unsupported_platform", "This music service isn't supported yet.")


def _spotify(segs: list[str]) -> ParsedLink:
    if segs and segs[0].startswith("intl-"):
        segs = segs[1:]
    if len(segs) >= 2 and segs[0] in ("track", "album", "playlist", "artist"):
        kind, sid = segs[0], segs[1]
        if not _SPOTIFY_ID.match(sid):
            raise LinkError("invalid_url", "Spotify link has an invalid ID.")
        return ParsedLink(
            platform=Platform.SPOTIFY,
            kind=MediaKind(kind),
            external_id=sid,
            canonical_url=f"https://open.spotify.com/{kind}/{sid}",
        )
    raise LinkError("invalid_url", "Couldn't find a Spotify track in that link.")


def _youtube_id(vid: str, platform: Platform) -> ParsedLink:
    if not _YT_ID.match(vid):
        raise LinkError("invalid_url", "YouTube link has an invalid video ID.")
    base = "https://music.youtube.com" if platform == Platform.YOUTUBE_MUSIC else "https://www.youtube.com"
    return ParsedLink(
        platform=platform,
        kind=MediaKind.VIDEO,
        external_id=vid,
        canonical_url=f"{base}/watch?v={vid}",
    )


def _youtube(segs: list[str], qs: dict[str, list[str]], platform: Platform) -> ParsedLink:
    if segs and segs[0] == "watch" and qs.get("v"):
        return _youtube_id(qs["v"][0], platform)
    if len(segs) >= 2 and segs[0] in ("shorts", "embed", "live", "v"):
        return _youtube_id(segs[1], platform)
    raise LinkError("invalid_url", "Couldn't find a YouTube video in that link.")


def _soundcloud(segs: list[str]) -> ParsedLink:
    if len(segs) >= 2 and "sets" not in segs[:2] and segs[0] not in ("discover", "search", "you"):
        user, track = segs[0], segs[1]
        if _SEG.match(user) and _SEG.match(track):
            return ParsedLink(
                platform=Platform.SOUNDCLOUD,
                kind=MediaKind.TRACK,
                external_id=f"{user}/{track}",
                canonical_url=f"https://soundcloud.com/{user}/{track}",
            )
    raise LinkError("invalid_url", "Couldn't find a SoundCloud track in that link.")


def _deezer(segs: list[str]) -> ParsedLink:
    # optional language prefix: /en/track/123
    if segs and re.fullmatch(r"[a-z]{2}(-[a-z]{2})?", segs[0]):
        segs = segs[1:]
    if len(segs) >= 2 and segs[0] in ("track", "album", "playlist", "artist") and segs[1].isdigit():
        return ParsedLink(
            platform=Platform.DEEZER,
            kind=MediaKind(segs[0]),
            external_id=segs[1],
            canonical_url=f"https://www.deezer.com/{segs[0]}/{segs[1]}",
        )
    raise LinkError("invalid_url", "Couldn't find a Deezer track in that link.")


def _apple(segs: list[str], qs: dict[str, list[str]]) -> ParsedLink:
    # /{storefront}/album/{slug}/{albumId}?i={trackId}  or /{sf}/song/{slug}/{id}
    if len(segs) >= 3 and re.fullmatch(r"[a-z]{2}", segs[0]):
        sf, kind = segs[0], segs[1]
        last = segs[-1]
        if kind == "song" and last.isdigit():
            return ParsedLink(
                platform=Platform.APPLE_MUSIC,
                kind=MediaKind.TRACK,
                external_id=last,
                canonical_url=f"https://music.apple.com/{sf}/song/{last}",
                extra={"storefront": sf},
            )
        if kind == "album" and last.isdigit():
            track_id = (qs.get("i") or [None])[0]
            if track_id and track_id.isdigit():
                return ParsedLink(
                    platform=Platform.APPLE_MUSIC,
                    kind=MediaKind.TRACK,
                    external_id=track_id,
                    canonical_url=f"https://music.apple.com/{sf}/song/{track_id}",
                    extra={"storefront": sf, "album_id": last},
                )
            return ParsedLink(
                platform=Platform.APPLE_MUSIC,
                kind=MediaKind.ALBUM,
                external_id=last,
                canonical_url=f"https://music.apple.com/{sf}/album/{last}",
                extra={"storefront": sf},
            )
    raise LinkError("invalid_url", "Couldn't find an Apple Music track in that link.")


def _bandcamp(host: str, segs: list[str]) -> ParsedLink:
    sub = host[: -len(".bandcamp.com")]
    if len(segs) >= 2 and segs[0] in ("track", "album") and _SEG.match(segs[1]) and sub:
        return ParsedLink(
            platform=Platform.BANDCAMP,
            kind=MediaKind(segs[0]),
            external_id=f"{sub}/{segs[1]}",
            canonical_url=f"https://{sub}.bandcamp.com/{segs[0]}/{segs[1]}",
            extra={"artist_subdomain": sub},
        )
    raise LinkError("invalid_url", "Couldn't find a Bandcamp track in that link.")
