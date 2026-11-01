from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class Platform(StrEnum):
    SPOTIFY = "spotify"
    YOUTUBE = "youtube"
    YOUTUBE_MUSIC = "youtube_music"
    SOUNDCLOUD = "soundcloud"
    DEEZER = "deezer"
    APPLE_MUSIC = "apple_music"
    BANDCAMP = "bandcamp"


class MediaKind(StrEnum):
    TRACK = "track"
    ALBUM = "album"
    PLAYLIST = "playlist"
    ARTIST = "artist"
    VIDEO = "video"


class ParsedLink(BaseModel):
    """Result of URL recognition, before any network metadata lookup."""

    platform: Platform
    kind: MediaKind
    external_id: str
    canonical_url: str
    # Platform-specific extras (e.g. Apple storefront, Bandcamp subdomain)
    extra: dict[str, str] = Field(default_factory=dict)


class Artist(BaseModel):
    name: str
    role: str = "primary"


class Album(BaseModel):
    name: str | None = None
    release_date: str | None = None
    label: str | None = None


class ArtworkRef(BaseModel):
    url: str
    origin: str
    verified: bool = False


class Artwork(BaseModel):
    original: ArtworkRef | None = None
    alternatives: list[ArtworkRef] = Field(default_factory=list)


class TrackSource(BaseModel):
    platform: Platform
    url: str
    external_id: str


class Track(BaseModel):
    """Normalized track. Unknown fields stay None — never fabricated."""

    id: str
    source: TrackSource
    title: str
    artists: list[Artist] = Field(default_factory=list)
    album: Album = Field(default_factory=Album)
    duration_ms: int | None = None
    isrc: str | None = None
    track_number: int | None = None
    explicit: bool | None = None
    genre: str | None = None
    artwork: Artwork = Field(default_factory=Artwork)
    links: dict[str, str] = Field(default_factory=dict)
