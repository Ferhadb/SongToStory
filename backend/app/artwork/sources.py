"""Artwork discovery. Each source returns ArtworkCandidate; failures never abort the others.

`verified` means matched by ISRC or taken from the track's own platform. Search-based matches
are suggestions only and are labelled as such in the UI."""

from __future__ import annotations

import asyncio
import re
from urllib.parse import quote

from pydantic import BaseModel

from app.providers.base import get_json
from app.schemas.track import Track

MB_HEADERS = {"User-Agent": "MusicStoryStudio/0.1 (personal project)"}


class ArtworkCandidate(BaseModel):
    url: str
    origin: str  # platform | musicbrainz | apple_music | deezer
    label: str
    verified: bool = False


def _query(t: Track) -> tuple[str, str]:
    artist = t.artists[0].name if t.artists else ""
    return artist, t.title


async def from_track(t: Track) -> list[ArtworkCandidate]:
    out = []
    if t.artwork.original:
        out.append(ArtworkCandidate(url=t.artwork.original.url, origin=t.artwork.original.origin,
                                    label=f"From {t.source.platform.value.replace('_', ' ')}",
                                    verified=t.artwork.original.verified))
    return out


async def from_musicbrainz(t: Track) -> list[ArtworkCandidate]:
    if not t.isrc or not re.fullmatch(r"[A-Z0-9]{12}", t.isrc.upper()):
        return []
    d = await get_json(f"https://musicbrainz.org/ws/2/isrc/{t.isrc.upper()}?fmt=json&inc=releases", MB_HEADERS)
    out, seen = [], set()
    for rec in d.get("recordings", []):
        for rel in rec.get("releases", [])[:3]:
            rid = rel.get("id")
            if rid and rid not in seen and re.fullmatch(r"[0-9a-f-]{36}", rid):
                seen.add(rid)
                out.append(ArtworkCandidate(
                    url=f"https://coverartarchive.org/release/{rid}/front-1200",
                    origin="musicbrainz", label=f"Cover Art Archive · {rel.get('title', 'release')}", verified=True))
    return out[:3]


async def from_itunes(t: Track) -> list[ArtworkCandidate]:
    artist, title = _query(t)
    d = await get_json(f"https://itunes.apple.com/search?entity=song&limit=4&term={quote(f'{artist} {title}'.strip())}")
    out = []
    for r in d.get("results", []):
        art = r.get("artworkUrl100")
        if art:
            out.append(ArtworkCandidate(
                url=re.sub(r"/\d+x\d+bb\.", "/1200x1200bb.", art), origin="apple_music",
                label=f"Apple Music · {r.get('collectionName', '')}"[:80]))
    return out


async def from_deezer(t: Track) -> list[ArtworkCandidate]:
    artist, title = _query(t)
    q = quote(f'artist:"{artist}" track:"{title}"' if artist else title)
    d = await get_json(f"https://api.deezer.com/search?limit=4&q={q}")
    out = []
    for r in d.get("data", []):
        cover = (r.get("album") or {}).get("cover_xl")
        if cover:
            out.append(ArtworkCandidate(url=cover, origin="deezer", label=f"Deezer · {(r['album'].get('title') or '')}"[:80]))
    return out


SOURCES = [from_track, from_musicbrainz, from_itunes, from_deezer]


async def find_artwork(t: Track) -> tuple[list[ArtworkCandidate], list[str]]:
    results = await asyncio.gather(*[s(t) for s in SOURCES], return_exceptions=True)
    out, warnings, seen = [], [], set()
    for src, res in zip(SOURCES, results, strict=True):
        if isinstance(res, Exception):
            warnings.append(f"{src.__name__.removeprefix('from_')} unavailable")
            continue
        for c in res:
            if c.url not in seen:
                seen.add(c.url)
                out.append(c)
    return out, warnings
