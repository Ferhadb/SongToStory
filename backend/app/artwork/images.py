"""Image validation + storage. Original bytes are kept as-is (no recompression)."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from app.audio.media import MediaError
from app.storage.assets import Asset, AssetStore

MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 64_000_000
MIN_SIDE = 64
Image.MAX_IMAGE_PIXELS = MAX_PIXELS  # decompression-bomb guard

_FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"),
            "WEBP": ("webp", "image/webp"), "GIF": ("gif", "image/gif")}


def inspect_image(data: bytes) -> tuple[str, str, int, int]:
    """Return (ext, mime, width, height) or raise MediaError. Decodes fully to catch corruption."""
    if len(data) > MAX_IMAGE_BYTES:
        raise MediaError("too_large", f"Image is larger than {MAX_IMAGE_BYTES // 1024 // 1024} MB.")
    try:
        with Image.open(io.BytesIO(data)) as im:
            fmt = im.format
            if fmt not in _FORMATS:
                raise MediaError("unsupported_format", "Unsupported image. Use JPG, PNG, WebP or GIF.")
            w, h = im.size
            im.load()
    except MediaError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, SyntaxError):
        raise MediaError("invalid_media", "That file couldn't be read as an image.") from None
    if min(w, h) < MIN_SIDE:
        raise MediaError("invalid_media", f"Image is too small (minimum {MIN_SIDE}px).")
    ext, mime = _FORMATS[fmt]
    return ext, mime, w, h


def save_image(store: AssetStore, data: bytes, origin: str, title: str | None) -> Asset:
    ext, mime, w, h = inspect_image(data)
    aid = store.new_id()
    dest: Path = store.blob_path(aid, ext)
    dest.write_bytes(data)
    return store.save_meta(Asset(
        id=aid, kind="image", origin=origin, filename=dest.name, mime=mime, size=len(data),
        width=w, height=h, title=title, created_at=store.now(),
    ))


MAX_PHOTO_SIDE = 4096


def _to_srgb(im: Image.Image, icc: bytes | None) -> Image.Image:
    """Bring the picture to plain sRGB so it looks the same in the editor and the render (phones shoot Display P3)."""
    if im.mode not in ("RGB", "RGBA", "L", "LA", "P"):
        return im.convert("RGB")  # CMYK etc.: the embedded profile does not describe RGB data
    if im.mode == "P":
        im = im.convert("RGBA")
    if icc and im.mode in ("RGB", "RGBA"):
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            alpha = im.getchannel("A") if im.mode == "RGBA" else None
            rgb = ImageCms.profileToProfile(im.convert("RGB"), src, ImageCms.createProfile("sRGB"), outputMode="RGB")
            if alpha is not None:
                rgb.putalpha(alpha)
            return rgb
        except (ImageCms.PyCMSError, OSError, ValueError):
            pass
    return im


def save_photo(store: AssetStore, data: bytes, title: str | None) -> Asset:
    """A user's own picture for a story background: orientation applied, sRGB, long side capped, stored as JPEG."""
    inspect_image(data)  # type / size / corruption checks, with the user-facing errors
    try:
        with Image.open(io.BytesIO(data)) as src:
            src.load()
            icc = src.info.get("icc_profile")
            im = ImageOps.exif_transpose(src)  # phones store the rotation in EXIF rather than in the pixels
        im = _to_srgb(im, icc)
        if im.mode in ("RGBA", "LA"):  # flatten transparency onto black
            flat = Image.new("RGB", im.size, (0, 0, 0))
            flat.paste(im, mask=im.getchannel("A"))
            im = flat
        elif im.mode != "RGB":
            im = im.convert("RGB")
        if max(im.size) > MAX_PHOTO_SIDE:
            im.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=92, optimize=True)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, SyntaxError):
        raise MediaError("invalid_media", "That file couldn't be read as an image.") from None
    blob = out.getvalue()
    aid = store.new_id()
    dest: Path = store.blob_path(aid, "jpg")
    dest.write_bytes(blob)
    return store.save_meta(Asset(
        id=aid, kind="image", origin="upload", filename=dest.name, mime="image/jpeg", size=len(blob),
        width=im.width, height=im.height, title=title, created_at=store.now(),
    ))
