"""The offline evaluation harness runs in CI (AI-evaluation-plan §7): every
critical case passes and no mandatory suite is skipped. Non-critical
failures are reported, not hidden; see evals/reports/latest.md."""

from __future__ import annotations

from evals import runner
from evals.harness import SUITES, wilson


def test_offline_evals_pass_every_critical_case() -> None:
    report = runner.run(list(SUITES))
    assert report["skipped_suites"] == []
    assert report["critical_failures"] == [], report["critical_failures"]
    assert report["verdict"] == "pass"
    assert report["overall"]["errors"] == 0


def test_a_run_with_a_skipped_suite_cannot_pass() -> None:
    report = runner.run(["scoring"])
    assert report["verdict"] == "fail" and "privacy" in report["skipped_suites"]


def test_wilson_interval() -> None:
    lo, hi = wilson(19, 20)
    assert (lo, hi) == (0.7639, 0.9911)  # Wilson 95% for 19/20
    assert wilson(0, 0) == (0.0, 0.0)


def test_compare_reports_flipped_cases() -> None:
    a = runner.run(list(SUITES))
    b = runner.run(list(SUITES))
    b["results"][0] = {**b["results"][0], "status": "fail"}
    assert "CASES THAT CHANGED (1)" in runner.compare(a, b)


def test_live_cost_is_read_after_the_cases_have_run() -> None:
    """The report's live_cost_usd used to read 0.0 for every live run: the CLI
    computed the spend as an argument, before runner.run made any model call.
    A callable is read when the report is built, so it sees the spend."""
    state = {"spent": 0.0}

    def model(payload: dict) -> dict:
        state["spent"] += 0.001
        return {"decision": "clarify", "ops": []}

    report = runner.run(["interpret"], provider="openai:stub", model=model, live_cost=lambda: round(state["spent"], 4))
    assert state["spent"] > 0, "the stub model was never called, so this test proves nothing"
    assert report["run"]["live_cost_usd"] == round(state["spent"], 4) > 0
    # A plain value still works (offline runs pass None).
    assert runner.run(["interpret"], provider="fake")["run"]["live_cost_usd"] is None
