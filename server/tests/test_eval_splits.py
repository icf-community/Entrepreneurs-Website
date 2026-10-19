"""S5 gap 1: held-out eval cases must never leak into a development or
validation file, and the manifest must match what is actually on disk
(catching a hand-edit that skipped re-running the authoring script)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

EVALS = Path(__file__).resolve().parent.parent / "evals"
sys.path.insert(0, str(EVALS.parent))

from evals.splits import DATASETS, assign, case_hash  # noqa: E402

TEXT_FIELDS = ("message", "text")


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _heldout_files() -> list[Path]:
    return sorted(DATASETS.glob("*.heldout.jsonl"))


def test_at_least_one_heldout_split_exists() -> None:
    assert _heldout_files(), "no *.heldout.jsonl found — splits.partition() was never run"


def test_heldout_locked() -> None:
    """No held-out case's own text appears in any non-held-out dataset
    file, and no held-out case's group was independently assigned to a
    non-heldout split (the split function must be internally consistent)."""
    main_files = [p for p in DATASETS.glob("*.jsonl") if not p.name.endswith(".heldout.jsonl")
                 and p.name != "manifest.json"]
    main_text: set[str] = set()
    for path in main_files:
        for case in _load(path):
            for field in TEXT_FIELDS:
                if case.get(field):
                    main_text.add(case[field])

    for heldout_path in _heldout_files():
        for case in _load(heldout_path):
            assert assign(case.get("group") or case["id"]) == "heldout", \
                f"{heldout_path.name}:{case['id']} has group {case.get('group')!r}, which assign() " \
                f"no longer routes to heldout — the dataset is stale, rerun the authoring script"
            for field in TEXT_FIELDS:
                text = case.get(field)
                if text and text in main_text:
                    raise AssertionError(
                        f"held-out case {case['id']} ({heldout_path.name}) leaked into a "
                        f"development/validation file: {text!r}")


def test_manifest_matches_disk() -> None:
    manifest_path = DATASETS / "manifest.json"
    assert manifest_path.exists(), "manifest.json missing — run python -m evals.splits"
    manifest = json.loads(manifest_path.read_text())
    for path in sorted(DATASETS.glob("*.jsonl")):
        recorded = manifest.get(path.name)
        assert recorded is not None, f"{path.name} has no manifest entry — run python -m evals.splits"
        for case in _load(path):
            expected = case_hash(case)
            got = recorded.get(case["id"])
            assert got == expected, (
                f"{path.name}:{case['id']} hash mismatch — edited without regenerating "
                f"the manifest (run python -m evals.splits)")
