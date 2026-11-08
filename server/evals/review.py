"""Human review of drafted eval labels (S5 gap 8).

Every case in adversarial.jsonl/benign.jsonl/transformations.jsonl was
drafted by Claude from the AI-plan's own rules, not hand-labelled by a
person — `label_provenance` says so on every one. This module turns
that draft into something a human can actually sign off on:

  python -m evals review-sheet                       -> datasets/review_sheet.csv
  python -m evals review-merge --reviewer A a.csv [--reviewer B b.csv]
                                                       -> datasets/reviews/<suite>.json

Selection (datasets/README.md explains the sizing): every critical case
from adversarial.jsonl, adversarial_assess.jsonl and
transformations.jsonl (anything safety- or correctness-critical gets
looked at), plus a deterministic 40-case sample of benign.jsonl (a
sample suffices there — benign correctness is lower-stakes and far
higher-volume). Held-out files are never included: nobody should see
held-out content while confirming a label.

"Confirmed" means every reviewer who looked at a case agreed; any
disagreement, or a single reviewer's "dispute", marks it disputed.
`unconfirmed_critical` is the gate: a release needs every critical case
either confirmed, or not have shipped a review sheet including it at
all (handled as "needs review" — see docstring on that function).
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

DATASETS = Path(__file__).resolve().parent / "datasets"
REVIEWS = DATASETS / "reviews"
BENIGN_SAMPLE = 40
FIELDS = ["id", "suite", "family", "critical", "content", "expected_summary", "label_provenance", "verdict", "notes"]


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _content(case: dict) -> str:
    if "message" in case:
        return case["message"]
    if "message_a" in case:
        return f"A: {case['message_a']!r} / B: {case['message_b']!r}"
    if "raw" in case:
        return f"ref_map={case.get('ref_map')} raw={case['raw']}"
    if "schema_attack" in case:
        return f"schema_attack={case['schema_attack']}"
    if "candidates" in case:
        return f"{case.get('mode')}: {case['kind']} over atoms={case.get('atoms')}"
    if "criteria" in case:
        return f"{case.get('mode')}: criteria={case['criteria']} members={list(case.get('members') or {})}"
    return json.dumps({k: v for k, v in case.items() if k not in FIELDS})[:200]


def _expected_summary(case: dict) -> str:
    if "members" in case:
        return json.dumps({name: m.get("expected") for name, m in case["members"].items()}, ensure_ascii=False)
    for key in ("expected", "relation"):
        if key in case:
            return json.dumps(case[key], ensure_ascii=False) if key == "expected" else case[key]
    return ""


def _benign_sample() -> list[dict]:
    cases = _load(DATASETS / "benign.jsonl")
    # The same deterministic hash family as splits.py, but a distinct
    # seed/purpose: this picks WHICH cases a human reviews, nothing to do
    # with which split they train/validate/test against.
    ranked = sorted(cases, key=lambda c: hashlib.sha256(f"review-sample-v1:{c['id']}".encode()).hexdigest())
    return ranked[:BENIGN_SAMPLE]


def select_for_review() -> list[dict]:
    out: list[dict] = []
    for suite in ("adversarial", "adversarial_assess", "assess_quality", "transformations"):
        out += [{**c, "suite": suite} for c in _load(DATASETS / f"{suite}.jsonl") if c.get("critical")]
    out += [{**c, "suite": "benign"} for c in _benign_sample()]
    return out


def write_review_sheet(path: Path | None = None) -> Path:
    path = path or (DATASETS / "review_sheet.csv")
    rows = select_for_review()
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        for case in rows:
            writer.writerow({
                "id": case["id"], "suite": case["suite"], "family": case.get("family", ""),
                "critical": case.get("critical", False), "content": _content(case),
                "expected_summary": _expected_summary(case), "label_provenance": case.get("label_provenance", ""),
                "verdict": "", "notes": "",
            })
    return path


def _read_sheet(path: Path) -> dict[str, dict]:
    with path.open(newline="") as f:
        return {row["id"]: row for row in csv.DictReader(f)}


def merge_reviews(reviewer_sheets: dict[str, Path]) -> dict[str, dict]:
    """{suite: {case_id: {"verdict": "confirmed"|"disputed", "reviewers": {name: raw_verdict}}}}."""
    sheets = {name: _read_sheet(path) for name, path in reviewer_sheets.items()}
    all_ids: set[str] = set()
    suite_by_id: dict[str, str] = {}
    for sheet in sheets.values():
        for case_id, row in sheet.items():
            all_ids.add(case_id)
            suite_by_id[case_id] = row["suite"]

    by_suite: dict[str, dict] = {}
    for case_id in sorted(all_ids):
        votes = {}
        for name, sheet in sheets.items():
            row = sheet.get(case_id)
            if row is None:
                continue
            raw = (row.get("verdict") or "").strip().lower()
            if raw not in ("confirm", "dispute"):
                continue
            votes[name] = raw
        verdict = "confirmed" if votes and all(v == "confirm" for v in votes.values()) else "disputed"
        suite = suite_by_id[case_id]
        by_suite.setdefault(suite, {})[case_id] = {"verdict": verdict, "reviewers": votes}

    REVIEWS.mkdir(parents=True, exist_ok=True)
    for suite, entries in by_suite.items():
        (REVIEWS / f"{suite}.json").write_text(json.dumps(entries, indent=2, sort_keys=True) + "\n")
    return by_suite


def unconfirmed_critical(suites: list[str]) -> list[str]:
    """Critical case ids in `suites` that were selected for review but are
    not confirmed — empty if no review sheet has been merged yet at all
    (review is opt-in until the owner runs it; this only blocks a release
    once a review has actually started and left something unresolved)."""
    if not REVIEWS.exists():
        return []
    selected = {c["id"] for c in select_for_review() if c.get("critical") and c["suite"] in suites}
    confirmed: set[str] = set()
    for suite in suites:
        path = REVIEWS / f"{suite}.json"
        if not path.exists():
            continue
        entries = json.loads(path.read_text())
        confirmed |= {cid for cid, v in entries.items() if v["verdict"] == "confirmed"}
    return sorted(selected - confirmed)
