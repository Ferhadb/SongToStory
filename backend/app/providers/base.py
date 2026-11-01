from __future__ import annotations

import html
import json
import re
from typing import Protocol
from urllib.parse import quote

from app.core.safe_fetch import safe_get
from app.schemas.track import ParsedLink, Track, TrackSource


class ProviderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code, self.message, self.retryable = code, message, retryable


class MetadataProvider(Protocol):
    async def fetch(self, link: ParsedLink) -> Track: ...


def source_of(link: ParsedLink) -> TrackSource:
    return TrackSource(platform=link.platform, url=link.canonical_url, external_id=link.external_id)


def track_id(link: ParsedLink) -> str:
    return f"{link.platform.value}:{link.external_id}"


async def get_json(url: str, headers: dict[str, str] | None = None) -> dict:
    try:
        resp = await safe_get(url, headers=headers)
    except Exception as e:  # network / unsafe URL
        raise ProviderError("provider_unavailable", "The music service didn't respond.", True) from e
    if resp.status_code == 404:
        raise ProviderError("not_found", "That track wasn't found.")
    if resp.status_code == 429:
        raise ProviderError("rate_limited", "The music service is rate-limiting us. Try again shortly.", True)
    if resp.status_code >= 400:
        raise ProviderError("provider_unavailable", f"The music service returned {resp.status_code}.", True)
    try:
        return resp.json()
    except json.JSONDecodeError as e:
        raise ProviderError("provider_unavailable", "Unexpected response from the music service.") from e


def oembed_url(endpoint: str, page_url: str) -> str:
    return f"{endpoint}?format=json&url={quote(page_url, safe='')}"


_META = re.compile(r'<meta\s+[^>]*?(?:property|name)=["\']([^"\']+)["\'][^>]*?content=["\']([^"\']*)["\']', re.IGNORECASE)


async def get_og(url: str) -> dict[str, str]:
    try:
        resp = await safe_get(url, headers={"User-Agent": "Mozilla/5.0 MusicStoryStudio"})
    except Exception as e:
        raise ProviderError("provider_unavailable", "The music service didn't respond.", True) from e
    if resp.status_code == 404:
        raise ProviderError("not_found", "That track wasn't found.")
    if resp.status_code >= 400:
        raise ProviderError("provider_unavailable", f"The music service returned {resp.status_code}.", True)
    return {k.lower(): html.unescape(v) for k, v in _META.findall(resp.text)}
