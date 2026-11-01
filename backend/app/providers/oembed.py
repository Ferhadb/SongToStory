"""YouTube / SoundCloud / Spotify (keyless) metadata via oEmbed. Artists are only set when the
service exposes them; otherwise left empty — never guessed."""

from __future__ import annotations

from app.providers.base import ProviderError, get_json, get_og, oembed_url, source_of, track_id
from app.schemas.track import Album, Artist, Artwork, ArtworkRef, ParsedLink, Platform, Track

_ENDPOINTS = {
    Platform.YOUTUBE: "https://www.youtube.com/oembed",
    Platform.YOUTUBE_MUSIC: "https://www.youtube.com/oembed",
    Platform.SOUNDCLOUD: "https://soundcloud.com/oembed",
    Platform.SPOTIFY: "https://open.spotify.com/oembed",
}


async def _spotify_page(url: str) -> tuple[list[str], str | None]:
    """oEmbed has no artist; the public page's tags do ("Artist · Album · Song · 2024"). Best effort."""
    try:
        og = await get_og(url)
    except ProviderError:
        return [], None
    parts = [p.strip() for p in og.get("og:description", "").split("·")]
    artist = og.get("music:musician_description") or (parts[0] if len(parts) >= 3 else "")
    album = parts[1] if len(parts) >= 4 and parts[-2].casefold() == "song" else None
    return ([artist] if artist else []), album


class OEmbedProvider:
    async def fetch(self, link: ParsedLink) -> Track:
        endpoint = _ENDPOINTS.get(link.platform)
        if not endpoint:
            raise ProviderError("unsupported_platform", "No metadata source for this platform.")
        page = link.canonical_url.replace("music.youtube.com", "www.youtube.com")
        d = await get_json(oembed_url(endpoint, page))
        title = d.get("title")
        if not title:
            raise ProviderError("not_found", "That track wasn't found.")
        artist = d.get("author_name")
        # YouTube "Artist - Title" convention; only split when unambiguous.
        if link.platform in (Platform.YOUTUBE, Platform.YOUTUBE_MUSIC) and " - " in title:
            a, t = title.split(" - ", 1)
            artist, title = a.strip(), t.strip()
        thumb = d.get("thumbnail_url")
        artists = [artist] if artist and link.platform != Platform.SPOTIFY else []
        album = None
        if link.platform == Platform.SPOTIFY:
            artists, album = await _spotify_page(link.canonical_url)
        return Track(
            id=track_id(link),
            source=source_of(link),
            title=title,
            artists=[Artist(name=a) for a in artists],
            album=Album(name=album),
            artwork=Artwork(
                original=ArtworkRef(url=thumb, origin=link.platform.value, verified=link.platform != Platform.YOUTUBE)
                if thumb
                else None
            ),
        )
