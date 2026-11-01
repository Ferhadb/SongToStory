from __future__ import annotations

from app.providers.apple import AppleMusicProvider
from app.providers.bandcamp import BandcampProvider
from app.providers.base import MetadataProvider, ProviderError
from app.providers.deezer import DeezerProvider
from app.providers.oembed import OEmbedProvider
from app.schemas.track import ParsedLink, Platform, Track

_OEMBED = OEmbedProvider()
PROVIDERS: dict[Platform, MetadataProvider] = {
    Platform.DEEZER: DeezerProvider(),
    Platform.APPLE_MUSIC: AppleMusicProvider(),
    Platform.BANDCAMP: BandcampProvider(),
    Platform.YOUTUBE: _OEMBED,
    Platform.YOUTUBE_MUSIC: _OEMBED,
    Platform.SOUNDCLOUD: _OEMBED,
    Platform.SPOTIFY: _OEMBED,
}


async def resolve(link: ParsedLink) -> Track:
    provider = PROVIDERS.get(link.platform)
    if provider is None:
        raise ProviderError("unsupported_platform", "This music service isn't supported yet.")
    return await provider.fetch(link)
