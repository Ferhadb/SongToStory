import base64
import subprocess

import numpy as np
import pytest

from app.audio.analysis import SR, analyze_file, analyze_samples, band_edges


def decode(r):
    a = np.frombuffer(base64.b64decode(r["data"]), dtype=np.uint8)
    return a.reshape(r["frames"], r["bands"] + 1)


def tone(freq, secs=1.0, amp=0.5):
    t = np.arange(int(SR * secs)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_frame_count_and_shape():
    r = analyze_samples(tone(440, 2.0), 30, 32)
    assert r["frames"] == 60 and r["bands"] == 32
    assert decode(r).shape == (60, 33)


@pytest.mark.parametrize("freq", [100, 1000, 6000])
def test_tone_peaks_in_the_right_band(freq):
    d = decode(analyze_samples(tone(freq), 30, 32))[10:20, :-1].mean(axis=0)
    edges = band_edges(32)
    expected = int(np.searchsorted(edges, freq) - 1)
    assert abs(int(d.argmax()) - expected) <= 1
    assert d.max() > 200


def test_silence_is_zero():
    d = decode(analyze_samples(np.zeros(SR, dtype=np.float32), 30, 16))
    assert d.max() == 0


def test_loud_passage_has_higher_rms_than_quiet():
    x = np.concatenate([tone(300, 1.0, 0.05), tone(300, 1.0, 0.8)])
    d = decode(analyze_samples(x, 30, 16))
    assert d[45:55, -1].mean() > d[5:15, -1].mean() + 50


def test_deterministic():
    x = tone(500, 1.0) + tone(2000, 1.0, 0.2)
    assert analyze_samples(x, 30, 24) == analyze_samples(x, 30, 24)


def _ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


async def test_analyze_file_and_cache(tmp_path):
    p = tmp_path / "a.m4a"
    _ffmpeg("-f", "lavfi", "-i", "sine=f=800:d=1", "-c:a", "aac", str(p))
    r1 = await analyze_file(p, 30, 16, tmp_path / "cache")
    assert r1["frames"] in (30, 31)
    assert (tmp_path / "cache" / "a-30-16.json").exists()
    assert await analyze_file(p, 30, 16, tmp_path / "cache") == r1
