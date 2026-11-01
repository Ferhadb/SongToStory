from app.matching.ranker import Candidate, Target, norm, rank

T = Target(title="Холод", artists=["Kai Angel"], duration_ms=180_000)


def C(vid, title, ch, dur):
    return Candidate(vid, title, ch, dur)


def test_official_beats_variants():
    ranked = rank(
        [
            C("a", "Kai Angel - Холод (sped up)", "Random", 150),
            C("b", "Kai Angel - Холод", "Kai Angel - Topic", 180),
            C("c", "Kai Angel Холод slowed + reverb", "x", 220),
            C("d", "Холод cover by Someone", "Someone", 181),
        ],
        T,
    )
    assert ranked[0].candidate.video_id == "b"
    assert ranked[0].official_channel and ranked[0].score >= 80
    assert all(r.score < ranked[0].score for r in ranked[1:])


def test_reasons_present_and_transparent():
    r = rank([C("a", "Kai Angel - Холод (sped up)", "R", 150)], T)[0]
    assert any("penalty: sped-up" in x for x in r.reasons)


def test_title_keyword_not_penalized_when_wanted():
    t = Target("Live Forever", ["Oasis"], 280_000)
    r = rank([C("a", "Oasis - Live Forever", "Oasis", 280)], t)[0]
    assert not any("penalty" in x for x in r.reasons)


def test_label_alone_is_not_official():
    r = rank([C("a", "Kai Angel - Холод (Official Audio)", "RandomUploader", 180)], T)[0]
    assert not r.official_channel


def test_dedupes_and_transliterates():
    assert len(rank([C("a", "x", "y", 1), C("a", "x", "y", 1)], T)) == 1
    assert norm("Холод") == "kholod"
