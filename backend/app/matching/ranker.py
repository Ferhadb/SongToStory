"""Transparent, pure candidate ranking. Every point added/removed carries a human-readable reason."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from rapidfuzz import fuzz

_CYR = dict(zip(
    "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
    ["a","b","v","g","d","e","e","zh","z","i","y","k","l","m","n","o","p","r","s","t","u","f","kh",
     "ts","ch","sh","shch","","y","","e","yu","ya"], strict=True))

PENALTIES = {
    r"\bcover\b|кавер": ("cover version", 30),
    r"\bremix\b|ремикс": ("remix", 25),
    r"sped.?up|speed.?up|nightcore": ("sped-up version", 30),
    r"slowed|reverb|8d audio": ("slowed/reverb/8D edit", 30),
    r"\blive\b|концерт": ("live recording", 15),
    r"instrumental|karaoke|минус": ("instrumental/karaoke", 25),
    r"\breaction\b|реакция|\btutorial\b|\blesson\b": ("reaction/tutorial", 40),
    r"\bshorts?\b": ("short clip", 15),
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    s = "".join(_CYR.get(c, c) for c in s)
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)  # drop bracketed tags for similarity
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass
class Candidate:
    video_id: str
    title: str
    channel: str
    duration_s: int | None = None
    thumbnail: str | None = None
    url: str = ""


@dataclass
class Target:
    title: str
    artists: list[str]
    duration_ms: int | None = None


@dataclass
class Ranked:
    candidate: Candidate
    score: int
    reasons: list[str] = field(default_factory=list)
    official_channel: bool = False


def score(c: Candidate, t: Target) -> Ranked:
    pts, why = 0.0, []
    full = norm(c.title)
    tt = norm(t.title)
    artist = norm(t.artists[0]) if t.artists else ""

    sim = fuzz.token_set_ratio(tt, full) if tt else 0
    pts += sim * 0.4
    why.append(f"title match {sim:.0f}%")
    if artist:
        a_in = artist in full or artist in norm(c.channel)
        pts += 20 if a_in else 0
        why.append("artist found in title/channel" if a_in else "artist not found")
    if tt and tt == re.sub(rf"\b{re.escape(artist)}\b", "", full).strip(" -"):
        pts += 5
        why.append("exact title")

    ch = c.channel.casefold()
    official = ch.endswith(("- topic", "vevo")) or (bool(artist) and norm(c.channel) == artist)
    if official:
        pts += 15
        why.append("artist/topic channel (likely official)")
    low = c.title.casefold()
    if re.search(r"official audio|official music video|официальн", low):
        pts += 8
        why.append("labelled official audio/video (not verified)")

    if t.duration_ms and c.duration_s:
        d = abs(c.duration_s - t.duration_ms / 1000)
        if d <= 3:
            pts += 17
            why.append("duration matches")
        elif d <= 10:
            pts += 8
            why.append(f"duration off by {d:.0f}s")
        elif d > 30:
            pts -= 15
            why.append(f"duration off by {d:.0f}s")

    # Don't penalize a keyword that is part of the wanted title itself (e.g. "Live Forever").
    for pat, (label, cost) in PENALTIES.items():
        if re.search(pat, low) and not re.search(pat, t.title.casefold()):
            pts -= cost
            why.append(f"penalty: {label}")

    return Ranked(c, max(0, min(100, round(pts))), why, official)


def rank(cands: list[Candidate], t: Target) -> list[Ranked]:
    seen, out = set(), []
    for c in cands:
        if c.video_id in seen:
            continue
        seen.add(c.video_id)
        out.append(score(c, t))
    return sorted(out, key=lambda r: r.score, reverse=True)
