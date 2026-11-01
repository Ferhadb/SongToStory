from __future__ import annotations

import re

from app.providers.base import ProviderError, get_json, source_of, track_id
from app.schemas.track import Album, Artist, Artwork, ArtworkRef, ParsedLink, Track


class AppleMusicProvider:
    """Uses the public iTunes Lookup API (no key)."""

    async def fetch(self, link: ParsedLink) -> Track:
        if link.kind.value != "track":
            raise ProviderError("unsupported_kind", "Please paste a link to a single track.")
        sf = link.extra.get("storefront", "us")
        d = await get_json(f"https://itunes.apple.com/lookup?id={link.external_id}&country={sf}&entity=song")
        results = [r for r in d.get("results", []) if r.get("wrapperType") == "track"]
        if not results:
            raise ProviderError("not_found", "That track wasn't found.")
        r = results[0]
        art = r.get("artworkUrl100")
        big = re.sub(r"/\d+x\d+bb\.", "/1200x1200bb.", art) if art else None
        return Track(
            id=track_id(link),
            source=source_of(link),
            title=r["trackName"],
            artists=[Artist(name=r["artistName"])],
            album=Album(name=r.get("collectionName"), release_date=(r.get("releaseDate") or "")[:10] or None),
            duration_ms=r.get("trackTimeMillis"),
            track_number=r.get("trackNumber"),
            explicit=r.get("trackExplicitness") == "explicit",
            genre=r.get("primaryGenreName"),
            artwork=Artwork(original=ArtworkRef(url=big, origin="apple_music", verified=True) if big else None),
            links={"preview": r["previewUrl"]} if r.get("previewUrl") else {},
        )
