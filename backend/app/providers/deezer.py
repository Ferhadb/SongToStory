from __future__ import annotations

from app.providers.base import ProviderError, get_json, source_of, track_id
from app.schemas.track import Album, Artist, Artwork, ArtworkRef, ParsedLink, Track


class DeezerProvider:
    async def fetch(self, link: ParsedLink) -> Track:
        if link.kind.value != "track":
            raise ProviderError("unsupported_kind", "Please paste a link to a single track.")
        d = await get_json(f"https://api.deezer.com/track/{link.external_id}")
        if "error" in d:
            raise ProviderError("not_found", "That track wasn't found.")
        album = d.get("album") or {}
        alts = [
            ArtworkRef(url=album[k], origin="deezer", verified=True)
            for k in ("cover_xl", "cover_big")
            if album.get(k)
        ]
        contributors = d.get("contributors") or []
        artists = [
            Artist(name=c["name"], role="primary" if i == 0 else "featured")
            for i, c in enumerate(contributors)
            if c.get("name")
        ] or ([Artist(name=d["artist"]["name"])] if d.get("artist") else [])
        return Track(
            id=track_id(link),
            source=source_of(link),
            title=d["title"],
            artists=artists,
            album=Album(name=album.get("title"), release_date=d.get("release_date")),
            duration_ms=d["duration"] * 1000 if d.get("duration") else None,
            isrc=d.get("isrc"),
            track_number=d.get("track_position"),
            explicit=d.get("explicit_lyrics"),
            artwork=Artwork(original=alts[0] if alts else None, alternatives=alts[1:]),
            links={"preview": d["preview"]} if d.get("preview") else {},
        )
