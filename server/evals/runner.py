"""Run suites, write JSON + Markdown reports, compare runs (§2, §7).

Exit status is non-zero when any critical case fails or errors, or when a
mandatory suite did not run: a run with skipped suites is never "passed".
"""

from __future__ import annotations

import json
import platform
import subprocess
import time
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

from app import privacy
from app.ai.schemas import ASSESS_PROMPT_VERSION, INTERPRET_PROMPT_VERSION, RUBRIC_VERSION, prompt_hash

from .dictionary import load as load_dictionary
from .harness import SUITES, Result, run_suite, wilson

MANDATORY = set(SUITES)


def _git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def run(suites: list[str], *, provider: str = "fake", model=None, live_cost=None) -> dict:
    started = time.time()
    results: list[Result] = []
    for suite in suites:
        results.extend(run_suite(suite, model if suite in ("interpret", "adversarial", "benign") else None))

    by_objective: dict[str, list[Result]] = defaultdict(list)
    by_slice: dict[str, list[Result]] = defaultdict(list)
    for r in results:
        for o in r.objectives:
            by_objective[o].append(r)
        by_slice[f"{r.suite}/{r.family}"].append(r)

    def summary(items: list[Result]) -> dict:
        passed = sum(r.status == "pass" for r in items)
        return {"total": len(items), "passed": passed, "failed": sum(r.status == "fail" for r in items),
                "errors": sum(r.status == "error" for r in items), "pass_rate": round(passed / len(items), 4) if items else None,
                "wilson_95": wilson(passed, len(items))}

    critical_failures = [r.case_id for r in results if r.critical and r.status != "pass"]
    skipped = sorted(MANDATORY - set(suites))
    ranking = [r for r in results if r.suite == "ranking" and r.metrics]
    return {
        "run": {
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
            "duration_s": round(time.time() - started, 2),
            "git": _git_sha(), "python": platform.python_version(), "provider": provider,
            "versions": {"dictionary": load_dictionary().version, "privacy": privacy.POLICY_VERSION,
                         "rubric": RUBRIC_VERSION, "interpret_prompt": INTERPRET_PROMPT_VERSION,
                         "interpret_prompt_hash": prompt_hash("interpret"), "assess_prompt": ASSESS_PROMPT_VERSION,
                         "assess_prompt_hash": prompt_hash("assess")},
            "live_cost_usd": live_cost,
        },
        "verdict": "pass" if not critical_failures and not skipped else "fail",
        "skipped_suites": skipped,
        "critical_failures": critical_failures,
        "overall": summary(results),
        "objectives": {o: summary(items) for o, items in sorted(by_objective.items())},
        "slices": {s: summary(items) for s, items in sorted(by_slice.items())},
        "ranking": {r.case_id: r.metrics for r in ranking},
        "results": [asdict(r) for r in results],
    }


def markdown(report: dict) -> str:
    lines = [
        "# Foundry AI evaluation report",
        "",
        f"Run {report['run']['started_at']} · git {report['run']['git']} · provider {report['run']['provider']} · "
        f"verdict **{report['verdict']}**",
        "",
        "This is a development smoke set with hand-labelled expectations, not a locked held-out evaluation. "
        "Offline runs use the fake provider: they test the deterministic pipeline, not model quality.",
        "",
        "## Objectives",
        "",
        "| Objective | Passed | Total | 95% interval |",
        "| --- | --- | --- | --- |",
    ]
    for o, s in report["objectives"].items():
        lines.append(f"| {o} | {s['passed']} | {s['total']} | {s['wilson_95'][0]:.2f}–{s['wilson_95'][1]:.2f} |")
    lines += ["", "## Slices", "", "| Slice | Passed | Total |", "| --- | --- | --- |"]
    for name, s in report["slices"].items():
        lines.append(f"| {name} | {s['passed']} | {s['total']} |")
    if report["ranking"]:
        lines += ["", "## Ranking", "", "| Scenario | recall@10 | nDCG@10 |", "| --- | --- | --- |"]
        for case_id, m in report["ranking"].items():
            lines.append(f"| {case_id} | {m['recall_at_10']:.2f} | {m['ndcg_at_10']:.2f} |")
    failures = [r for r in report["results"] if r["status"] != "pass"]
    lines += ["", f"## Failures and errors ({len(failures)})", ""]
    for r in failures:
        flag = " (critical)" if r["critical"] else ""
        lines.append(f"- `{r['case_id']}`{flag}: {'; '.join(r['details'])}")
    if report["skipped_suites"]:
        lines += ["", f"Skipped mandatory suites: {', '.join(report['skipped_suites'])} — this run cannot pass."]
    return "\n".join(lines) + "\n"


def compare(a: dict, b: dict) -> str:
    """Per-objective and per-slice deltas between two runs (programme G9)."""
    out = [f"A: {a['run']['started_at']} ({a['run']['git']})   B: {b['run']['started_at']} ({b['run']['git']})", ""]
    for section in ("objectives", "slices"):
        out.append(section.upper())
        for key in sorted(set(a[section]) | set(b[section])):
            ra, rb = a[section].get(key, {}).get("pass_rate"), b[section].get(key, {}).get("pass_rate")
            delta = "" if ra is None or rb is None else f"{rb - ra:+.2%}"
            out.append(f"  {key:<45} {ra if ra is not None else '—':>8}  →  {rb if rb is not None else '—':>8}  {delta}")
        out.append("")
    changed = {r["case_id"]: r["status"] for r in a["results"]}
    flips = [(r["case_id"], changed.get(r["case_id"]), r["status"]) for r in b["results"]
             if changed.get(r["case_id"]) != r["status"]]
    out.append(f"CASES THAT CHANGED ({len(flips)})")
    out += [f"  {cid}: {old} → {new}" for cid, old, new in flips]
    return "\n".join(out) + "\n"


def write(report: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    out.with_suffix(".md").write_text(markdown(report))
