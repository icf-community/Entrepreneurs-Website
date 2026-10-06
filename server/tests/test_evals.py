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
