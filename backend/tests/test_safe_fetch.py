import pytest

from app.core.safe_fetch import UnsafeUrlError, assert_public_url


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/",
        "https://127.0.0.1/",
        "https://localhost/",
        "https://169.254.169.254/latest/meta-data",
        "https://10.0.0.5/",
        "https://[::1]/",
        "https://[::ffff:127.0.0.1]/",
        "https://example.com:8443/",
        "https://u:p@example.com/",
    ],
)
async def test_blocks(url):
    with pytest.raises(UnsafeUrlError):
        await assert_public_url(url)


async def test_gzip_body_is_decoded(monkeypatch):
    import gzip

    import httpx
    import respx

    from app.core import safe_fetch

    async def ok(url):
        return None

    monkeypatch.setattr(safe_fetch, "assert_public_url", ok)
    with respx.mock:
        respx.get("https://example.com/x").mock(
            return_value=httpx.Response(
                200, content=gzip.compress(b'{"a":1}'), headers={"content-encoding": "gzip"}
            )
        )
        r = await safe_fetch.safe_get("https://example.com/x")
    assert r.json() == {"a": 1}
