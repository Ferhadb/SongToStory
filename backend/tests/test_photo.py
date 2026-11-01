import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.artwork.images import MAX_PHOTO_SIDE, save_photo
from app.audio.media import MediaError
from app.rendering.service import RenderError, validate_project
from app.storage.assets import Asset, AssetStore
from tests.test_render import FAKE_OK, manager, project


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", AssetStore(tmp_path))
    return TestClient(main.app)


def jpeg(size=(200, 100), orientation=None, icc=None, mode="RGB", fmt="JPEG"):
    im = Image.new(mode, size, (30, 120, 200) if mode == "RGB" else 128)
    for x in range(size[0] // 2):  # left half red so rotation is detectable
        for y in range(size[1]):
            im.putpixel((x, y), (220, 20, 20) if mode == "RGB" else 255)
    kw = {}
    if orientation:
        ex = Image.Exif()
        ex[274] = orientation
        kw["exif"] = ex.tobytes()
    if icc:
        kw["icc_profile"] = icc
    b = io.BytesIO()
    im.save(b, fmt, **kw)
    return b.getvalue()


def test_exif_rotation_is_applied(tmp_path):
    store = AssetStore(tmp_path)
    a = save_photo(store, jpeg((200, 100), orientation=6), "p.jpg")  # "rotate 90° clockwise to view"
    assert (a.width, a.height) == (100, 200)
    assert a.kind == "image" and a.mime == "image/jpeg" and a.filename.endswith(".jpg")
    with Image.open(store.path_of(a)) as out:
        assert out.size == (100, 200)
        assert not out.getexif().get(274)


def test_large_photos_are_capped_and_small_ones_untouched(tmp_path):
    store = AssetStore(tmp_path)
    big = save_photo(store, jpeg((5000, 2500)), None)
    assert max(big.width, big.height) == MAX_PHOTO_SIDE and (big.width, big.height) == (4096, 2048)
    small = save_photo(store, jpeg((640, 480)), None)
    assert (small.width, small.height) == (640, 480)


def test_png_with_alpha_is_flattened_and_palette_images_convert(tmp_path):
    store = AssetStore(tmp_path)
    a = save_photo(store, jpeg((120, 120), mode="RGBA", fmt="PNG"), None)
    with Image.open(store.path_of(a)) as out:
        assert out.mode == "RGB"
    pal = io.BytesIO()
    Image.new("P", (100, 100)).save(pal, "GIF")
    assert save_photo(store, pal.getvalue(), None).mime == "image/jpeg"


def test_wide_gamut_profile_is_converted_to_srgb(tmp_path):
    from PIL import ImageCms

    store = AssetStore(tmp_path)
    prof = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    a = save_photo(store, jpeg((100, 100), icc=prof), None)
    assert a.width == 100


@pytest.mark.parametrize("data,code", [
    (b"not an image at all", "invalid_media"),
    (b"\xff\xd8\xff\xe0 truncated", "invalid_media"),
    (jpeg((20, 20)), "invalid_media"),  # smaller than the minimum side
])
def test_invalid_photos_are_rejected_with_a_clear_message(tmp_path, data, code):
    with pytest.raises(MediaError) as e:
        save_photo(AssetStore(tmp_path), data, None)
    assert e.value.code == code and e.value.message


def test_unsupported_format_names_the_supported_ones(tmp_path):
    b = io.BytesIO()
    Image.new("RGB", (100, 100)).save(b, "BMP")
    with pytest.raises(MediaError) as e:
        save_photo(AssetStore(tmp_path), b.getvalue(), None)
    assert e.value.code == "unsupported_format" and "JPG" in e.value.message


def test_upload_endpoint(client):
    r = client.post("/api/v1/uploads/photo", files={"file": ("me.jpg", jpeg((300, 200), orientation=6), "image/jpeg")})
    assert r.status_code == 200
    body = r.json()
    assert (body["width"], body["height"]) == (200, 300) and body["kind"] == "image"
    assert client.get(f"/api/v1/assets/{body['id']}/stream").headers["content-type"] == "image/jpeg"
    bad = client.post("/api/v1/uploads/photo", files={"file": ("me.jpg", b"nope", "image/jpeg")})
    assert bad.status_code == 422 and bad.json()["detail"]["error"]["code"] == "invalid_media"


def photo_project(store, tmp_path):
    p = project(store)
    img = save_photo(store, jpeg((400, 300)), None)
    p["background"] = {"type": "photo"}
    p["photo"] = {"assetId": img.id, "width": 400, "height": 300, "zoom": 1, "focusX": 0.5, "focusY": 0.5, "dim": 0.2}
    p["elements"] = [{"x": 0, "y": 0, "w": 900, "h": 400, "type": "player", "visible": True,
                      "player": {"style": "apple", "title": None, "artist": None, "artwork": None}}]
    return p


def test_photo_story_validates(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    validate_project(photo_project(store, tmp_path), store, m.s)


def err(p, store, s):
    with pytest.raises(RenderError) as e:
        validate_project(p, store, s)
    return e.value


def test_missing_or_invalid_photo_assets_give_clear_export_errors(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    # no photo chosen yet
    p = photo_project(store, tmp_path)
    p["photo"] = None
    e = err(p, store, m.s)
    assert e.code == "missing_photo" and "Add a photo" in e.message
    # asset gone from the server
    p = photo_project(store, tmp_path)
    p["photo"]["assetId"] = "f" * 32
    e = err(p, store, m.s)
    assert e.code == "missing_photo" and "photo" in e.message and "Upload it again" in e.message
    # asset id of the wrong kind
    p = photo_project(store, tmp_path)
    audio = store.save_meta(Asset(id=store.new_id(), kind="audio", origin="upload", filename="a.wav", mime="audio/wav", size=1, created_at="t"))
    p["photo"]["assetId"] = audio.id
    assert err(p, store, m.s).code == "invalid_photo"
    # not even an id
    p = photo_project(store, tmp_path)
    p["photo"]["assetId"] = {"x": 1}
    assert err(p, store, m.s).code == "missing_photo"
    # crop out of range
    for k, v in (("zoom", 9), ("focusX", -1), ("dim", 2), ("zoom", "big")):
        p = photo_project(store, tmp_path)
        p["photo"][k] = v
        assert err(p, store, m.s).code == "invalid_project"
    # player card artwork missing
    p = photo_project(store, tmp_path)
    p["elements"][0]["player"]["artwork"] = {"assetId": "e" * 32}
    e = err(p, store, m.s)
    assert e.code == "missing_media" and "player card" in e.message
    # ...but a hidden player does not block the export
    p["elements"][0]["visible"] = False
    validate_project(p, store, m.s)


def test_other_templates_do_not_need_a_photo(tmp_path):
    m, store = manager(tmp_path, FAKE_OK)
    p = project(store)
    p["photo"] = None
    validate_project(p, store, m.s)


async def test_photo_story_renders_through_the_job_pipeline(tmp_path):
    from tests.test_render import wait_done

    m, store = manager(tmp_path, FAKE_OK)
    done = await wait_done(m, m.submit(photo_project(store, tmp_path), "draft")["id"])
    assert done["status"] == "completed", done
    job = json.loads((m.root / done["id"] / "job.json").read_text())
    assert job["project"]["background"] == {"type": "photo"}
