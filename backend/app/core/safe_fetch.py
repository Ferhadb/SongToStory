"""SSRF-safe HTTP fetching. All outbound requests to user-influenced URLs go through here."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx

MAX_REDIRECTS = 5
MAX_BYTES = 5 * 1024 * 1024
TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class UnsafeUrlError(ValueError):
    pass


def _ip_is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if getattr(addr, "ipv4_mapped", None):
        addr = addr.ipv4_mapped
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


async def assert_public_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise UnsafeUrlError("Only https URLs are allowed.")
    host = parts.hostname
    if not host or parts.username or parts.password:
        raise UnsafeUrlError("Invalid URL.")
    port = parts.port or 443
    if port != 443:
        raise UnsafeUrlError("Non-standard ports are not allowed.")
    try:
        ipaddress.ip_address(host)
        infos = [host]
    except ValueError:
        loop = asyncio.get_running_loop()
        try:
            res = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except socket.gaierror as e:
            raise UnsafeUrlError("Host could not be resolved.") from e
        infos = [r[4][0] for r in res]
    if not infos or not all(_ip_is_public(ip) for ip in infos):
        raise UnsafeUrlError("URL resolves to a non-public address.")


async def safe_get(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
    max_bytes: int = MAX_BYTES,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    """GET with per-hop validation of redirects, size cap, and no env proxies."""
    own = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, trust_env=False)
    try:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            await assert_public_url(current)
            async with client.stream("GET", current, headers=headers) as resp:
                if resp.is_redirect:
                    loc = resp.headers.get("location")
                    if not loc:
                        raise UnsafeUrlError("Redirect without location.")
                    current = urljoin(current, loc)
                    continue
                body = bytearray()
                async for chunk in resp.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise UnsafeUrlError("Response too large.")
                # Body is already decoded by aiter_bytes; drop stale encoding headers.
                headers = {
                    k: v
                    for k, v in resp.headers.items()
                    if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")
                }
                return httpx.Response(
                    resp.status_code, headers=headers, content=bytes(body), request=resp.request
                )
        raise UnsafeUrlError("Too many redirects.")
    finally:
        if own:
            await client.aclose()
