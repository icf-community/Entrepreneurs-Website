"""S5 gap 7: record/replay/resume cache + --repeats aggregation."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from evals.fixtures import CachedModel, CURRENT_CASE_ID, ReplayMiss  # noqa: E402
from evals.runner import aggregate_repeats  # noqa: E402


def test_cache_records_a_live_call_then_resumes_without_recalling(tmp_path) -> None:
    cache_path = tmp_path / "cache.json"
    calls = []

    def live(payload):
        calls.append(payload)
        return {"decision": "apply", "ops": []}

    token = CURRENT_CASE_ID.set("case-1")
    try:
        model = CachedModel(cache_path, live_model=live, strict=False)
        model({"message": "a"})
        model({"message": "a"})  # same case id — must not call live again
    finally:
        CURRENT_CASE_ID.reset(token)
    assert len(calls) == 1
    assert cache_path.exists()

    # A fresh process (new CachedModel instance) resumes from the file.
    token = CURRENT_CASE_ID.set("case-1")
    try:
        resumed = CachedModel(cache_path, live_model=live, strict=False)
        resumed({"message": "a"})
    finally:
        CURRENT_CASE_ID.reset(token)
    assert len(calls) == 1, "resume must not re-call (and re-charge) an already-cached case"


def test_replay_is_strict_and_never_calls_live() -> None:
    def live(payload):
        raise AssertionError("replay must never reach the live model")

    model = CachedModel(Path("/nonexistent-cache-for-this-test.json"), live_model=live, strict=True)
    token = CURRENT_CASE_ID.set("case-missing")
    try:
        try:
            model({"message": "a"})
            raise AssertionError("expected ReplayMiss")
        except ReplayMiss:
            pass
    finally:
        CURRENT_CASE_ID.reset(token)


def test_replay_returns_the_recorded_answer_for_a_known_case(tmp_path) -> None:
    cache_path = tmp_path / "cache.json"
    cache_path.write_text('{"case-1": {"decision": "apply", "ops": [{"op": "add", "concept": "python"}]}}')
    model = CachedModel(cache_path, live_model=None, strict=True)
    token = CURRENT_CASE_ID.set("case-1")
    try:
        result = model({"message": "doesn't matter in replay"})
    finally:
        CURRENT_CASE_ID.reset(token)
    assert result == {"decision": "apply", "ops": [{"op": "add", "concept": "python"}]}


def _fake_report(statuses: dict[str, str], critical: dict[str, bool]) -> dict:
    return {
        "run": {}, "verdict": "pass", "skipped_suites": [],
        "critical_failures": [cid for cid, s in statuses.items() if critical.get(cid) and s != "pass"],
        "overall": {}, "objectives": {}, "slices": {}, "ranking": {},
        "results": [{"case_id": cid, "suite": "fake", "status": s, "critical": critical.get(cid, False)}
                    for cid, s in statuses.items()],
    }


def test_aggregate_repeats_counts_a_flaky_case_as_a_pass_if_it_ever_passed() -> None:
    reports = [
        _fake_report({"flaky": "fail", "always-fails": "fail"}, {"flaky": True, "always-fails": True}),
        _fake_report({"flaky": "pass", "always-fails": "fail"}, {"flaky": True, "always-fails": True}),
    ]
    merged = aggregate_repeats(reports)
    assert merged["repeats"]["flaky"]["pass_rate"] == 0.5
    assert merged["repeats"]["always-fails"]["pass_rate"] == 0.0
    assert merged["critical_failures"] == ["always-fails"]
    assert merged["verdict"] == "fail"


def test_aggregate_repeats_does_not_blend_cases_that_share_an_id_across_suites() -> None:
    """interpret.jsonl and adversarial.jsonl happen to both use "adv-scope-001"
    for unrelated cases — same id, different suite. Each suite's own history
    must stay separate, not get merged into one blended pass_rate."""
    def report(a_status: str, b_status: str) -> dict:
        return {
            "run": {}, "verdict": "pass", "skipped_suites": [],
            "critical_failures": [], "overall": {}, "objectives": {}, "slices": {}, "ranking": {},
            "results": [
                {"case_id": "adv-scope-001", "suite": "interpret", "status": a_status, "critical": True},
                {"case_id": "adv-scope-001", "suite": "adversarial", "status": b_status, "critical": True},
            ],
        }
    reports = [report("pass", "fail"), report("pass", "fail")]
    merged = aggregate_repeats(reports)
    assert merged["repeats"]["interpret/adv-scope-001"]["pass_rate"] == 1.0
    assert merged["repeats"]["adversarial/adv-scope-001"]["pass_rate"] == 0.0
    assert merged["critical_failures"] == ["adv-scope-001"]
