"""S5 gap 8: review-sheet selection and review-merge confirm/dispute logic."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from evals.review import FIELDS, merge_reviews, select_for_review, write_review_sheet  # noqa: E402


def test_review_sheet_only_includes_critical_and_a_benign_sample(tmp_path) -> None:
    path = write_review_sheet(tmp_path / "sheet.csv")
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    assert rows, "review sheet is empty"
    assert set(rows[0].keys()) == set(FIELDS)
    by_suite = {}
    for r in rows:
        by_suite[r["suite"]] = by_suite.get(r["suite"], 0) + 1
    assert by_suite.get("benign", 0) == 40
    non_benign = [r for r in rows if r["suite"] != "benign"]
    assert all(r["critical"] == "True" for r in non_benign)


def test_review_sheet_selection_is_deterministic() -> None:
    assert [c["id"] for c in select_for_review()] == [c["id"] for c in select_for_review()]


def test_merge_confirms_only_on_unanimous_confirm(tmp_path) -> None:
    sheet = write_review_sheet(tmp_path / "sheet.csv")
    with sheet.open(newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) >= 2

    def _write(path: Path, verdicts: dict[str, str]) -> None:
        out = []
        for r in rows:
            r = dict(r)
            r["verdict"] = verdicts.get(r["id"], "confirm")
            out.append(r)
        with path.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(out)

    disputed_id = rows[0]["id"]
    _write(tmp_path / "a.csv", {disputed_id: "dispute"})
    _write(tmp_path / "b.csv", {})

    import evals.review as review_mod
    review_mod.REVIEWS = tmp_path / "reviews"
    by_suite = merge_reviews({"A": tmp_path / "a.csv", "B": tmp_path / "b.csv"})

    disputed_suite = rows[0]["suite"]
    entry = by_suite[disputed_suite][disputed_id]
    assert entry["verdict"] == "disputed"
    assert entry["reviewers"] == {"A": "dispute", "B": "confirm"}
    other = next(r for r in rows if r["id"] != disputed_id)
    assert by_suite[other["suite"]][other["id"]]["verdict"] == "confirmed"
