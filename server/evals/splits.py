"""Deterministic development/validation/held-out splits (S5 gap 1).

A case's `group` (not its `id`) decides its split, so paraphrase
variants authored with the same group always land together — no
variant of a held-out case can leak into development just because it
has a different id. The split is a seeded hash of the group id, so it
is stable across runs and across which other groups exist (adding a
new case never reshuffles an existing one).

Held-out cases never live in the suite's main .jsonl: `partition`
splits them out, and the authoring scripts write them to a sibling
`<suite>.heldout.jsonl`. `datasets/manifest.json` records a SHA-256 of
every case (by id) across every dataset file, so `test_heldout_locked`
can prove no held-out text was copied into a non-held-out file.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

DATASETS = Path(__file__).resolve().parent / "datasets"
RATIOS = {"development": 0.5, "validation": 0.2, "heldout": 0.3}
SEED = "foundry-ai-eval-splits-v1"


def assign(group: str) -> str:
    """development | validation | heldout, stable for a given group id."""
    digest = hashlib.sha256(f"{SEED}:{group}".encode()).hexdigest()
    bucket = int(digest[:8], 16) / 0xFFFFFFFF  # deterministic float in [0, 1)
    if bucket < RATIOS["development"]:
        return "development"
    if bucket < RATIOS["development"] + RATIOS["validation"]:
        return "validation"
    return "heldout"


def partition(cases: list[dict]) -> tuple[list[dict], list[dict]]:
    """(main_cases, heldout_cases), each case stamped with its `split`."""
    main, heldout = [], []
    for case in cases:
        split = assign(case.get("group") or case["id"])
        case = {**case, "split": split}
        (heldout if split == "heldout" else main).append(case)
    return main, heldout


def case_hash(case: dict) -> str:
    """SHA-256 over the case's own fields, excluding `split` (which is
    derived, not authored content) so re-running partition() doesn't
    change every hash."""
    material = {k: v for k, v in case.items() if k != "split"}
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def write_manifest() -> dict:
    """Hash every case in every datasets/*.jsonl (including *.heldout.jsonl)
    and write manifest.json. Run after any authoring script regenerates
    its output."""
    manifest: dict[str, dict] = {}
    for path in sorted(DATASETS.glob("*.jsonl")):
        entries = {}
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            case = json.loads(line)
            entries[case["id"]] = case_hash(case)
        manifest[path.name] = entries
    out = DATASETS / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


if __name__ == "__main__":
    m = write_manifest()
    total = sum(len(v) for v in m.values())
    print(f"manifest.json: {len(m)} files, {total} cases hashed")
