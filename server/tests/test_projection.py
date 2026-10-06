"""Member and job projections (app/projection.py, AI-plan §6, §7.1)."""

from __future__ import annotations

from datetime import date

from app import privacy
from app.projection import build_member_docs, experience_months
from tests.test_concepts import D


def test_experience_counts_overlapping_roles_once() -> None:
    roles = [
        {"start_date": "2022-01", "end_date": "2022-12", "is_current": False},
        {"start_date": "2022-06", "end_date": "2023-05", "is_current": False},
    ]
    assert experience_months(roles) == 17


def test_experience_unknown_when_a_start_date_is_missing() -> None:
    assert experience_months([{"start_date": None, "end_date": "2023-01"}]) is None


def test_ongoing_role_runs_to_today() -> None:
    roles = [{"start_date": "2024-01", "end_date": "current", "is_current": True}]
    assert experience_months(roles, today=date(2024, 12, 15)) == 12


def _source(**overrides) -> dict:
    src = {
        "member_id": "m", "version": 3, "status": "approved", "role": "student", "is_committee": False,
        "course": "Computing", "bio_focus": "Training PyTorch models; contact jane@x.com",
        "bio_hobbies": "Chess and running",
        "identifiers": {"first_name": "Jane", "surname": "Doe"},
        "settings": {"recruiter_discoverable": False, "network_discoverable": True, "consent_epoch": 2,
                     "network_offers": ["python"], "network_seeks": []},
        "skill_tags": ["Deep learning"], "sector_tags": ["Climate / Energy"],
        "interests": [{"kind": "hobby", "label": "Chess"}], "intents": ["find_cofounder"],
        "cv": {"skills_raw": ["PyTorch", "No TensorFlow"], "projects": [], "roles": [], "education": []},
        "github": None,
    }
    src.update(overrides)
    return src


def test_builds_only_the_purposes_the_member_consented_to() -> None:
    docs, _ = build_member_docs(_source(), D)
    assert sorted(d["purpose"] for d in docs) == ["network", "self"]
    docs, _ = build_member_docs(_source(is_committee=True), D)
    assert [d["purpose"] for d in docs] == ["self"]


def test_evidence_is_minimised_and_negations_are_not_concepts() -> None:
    docs, rows = build_member_docs(_source(), D)
    text = " ".join(r["text"] for r in rows)
    assert "jane@x.com" not in text and "Jane" not in text
    privacy.assert_clean(text)
    self_doc = next(d for d in docs if d["purpose"] == "self")
    assert "pytorch" in self_doc["concepts"] and "tensorflow" not in self_doc["concepts"]
    assert "deep-learning" in self_doc["concepts"]


def test_hobbies_and_seek_offer_stay_in_network_only() -> None:
    docs, rows = build_member_docs(_source(), D)
    network = {r["source_kind"] for r in rows if r["purpose"] == "network"}
    self_kinds = {r["source_kind"] for r in rows if r["purpose"] == "self"}
    assert {"bio_hobbies", "intent", "offer"} <= network
    assert not ({"bio_hobbies", "intent", "offer"} & self_kinds)
    assert any(r["from_cv"] for r in rows if r["source_kind"] == "cv_skill")


def test_projection_hash_changes_with_content_only() -> None:
    a, _ = build_member_docs(_source(), D)
    b, _ = build_member_docs(_source(), D)
    c, _ = build_member_docs(_source(bio_focus="Building React apps"), D)
    assert a[0]["projection_hash"] == b[0]["projection_hash"] != c[0]["projection_hash"]


def test_self_reported_experience_is_labelled_and_minimised() -> None:
    src = _source(cv=None, settings={"recruiter_discoverable": True, "network_discoverable": False, "consent_epoch": 1,
                                     "self_reported": "Led a FastAPI backend at a startup. Email jane@x.com for details."})
    docs, rows = build_member_docs(src, D)
    lines = [r for r in rows if r["source_kind"] == "self_reported"]
    assert lines and all(r["text"].startswith("Self-reported:") for r in lines)
    assert not any("jane@x.com" in r["text"] for r in lines)
    assert not any(r["from_cv"] for r in lines)
