from __future__ import annotations

from app.providers.base import ProviderError, get_og, source_of, track_id
from app.schemas.track import Album, Artist, Artwork, ArtworkRef, ParsedLink, Track


class BandcampProvider:
    async def fetch(self, link: ParsedLink) -> Track:
        if link.kind.value != "track":
            raise ProviderError("unsupported_kind", "Please paste a link to a single track.")
        og = await get_og(link.canonical_url)
        title = og.get("og:title")
        if not title:
            raise ProviderError("not_found", "Couldn't read track details from that page.")
        # Bandcamp og:title is "Track, by Artist"
        artist = None
        if ", by " in title:
            title, artist = title.rsplit(", by ", 1)
        image = og.get("og:image")
        return Track(
            id=track_id(link),
            source=source_of(link),
            title=title.strip(),
            artists=[Artist(name=artist.strip())] if artist else [],
            album=Album(),
            artwork=Artwork(original=ArtworkRef(url=image, origin="bandcamp", verified=True) if image else None),
        )
