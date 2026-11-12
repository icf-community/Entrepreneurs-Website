"""Source for datasets/transformations.jsonl (S5 gap 2). Run:
python -m evals.authoring.transformations

Each case asserts one stated invariance property (AI-evaluation-plan
§5) between a "base" and a "variant" side, driving the exact same
primitives the other suites use (harness.score_transform) — never a
re-implementation of the scoring or interpretation rules.

Three of the plan's listed properties are deliberately not modelled
here, each for a documented structural reason rather than oversight:
  - swapping cohort/name/avatar: `score_candidate` takes no identity
    field at all (see its signature in app/ai/score.py) — there is no
    code path by which a name or avatar could reach a score, so there
    is nothing a harness-level pair could exercise beyond what the type
    system already guarantees.
  - only preferences changing (location/role_type): `_preference()` in
    pipeline.py computes preference match entirely separately from
    `score_candidate` and is never passed into it (AI-plan §14.3) — same
    structural guarantee as above.
  - source expiry: `ai_private.effective_spec` strips expired atoms
    before scoring ever sees them; this is a DB-level concern already
    covered by test_ai_properties.py's invariant #4 (no stale atom in
    effective_spec), not re-tested at this offline layer.
"""

from __future__ import annotations

import json

CASES: list[dict] = [
    # ── duplicate / irrelevant evidence must not change the score ──────
    {
        "id": "xf-duplicate-evidence-001", "family": "duplicate-evidence", "objectives": ["O05", "O06"],
        "critical": True, "kind": "scoring_pair", "mode": "recruiter",
        "atoms": [{"id": "t1", "kind": "tool", "concept": "pytorch", "required": False}],
        "candidates": {
            "base": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["pytorch"], "polarity": "positive"}],
                     "task": "some", "depth": "some"},
            "variant": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["pytorch"], "polarity": "positive"},
                                     {"id": 2, "kind": "cv_skill", "concepts": ["pytorch"], "polarity": "positive"}],
                       "task": "some", "depth": "some"},
        },
        "relation": "equal_score",
    },
    {
        "id": "xf-irrelevant-evidence-001", "family": "irrelevant-evidence", "objectives": ["O05", "O06"],
        "critical": True, "kind": "scoring_pair", "mode": "recruiter",
        "atoms": [{"id": "t1", "kind": "tool", "concept": "react", "required": False}],
        "candidates": {
            "base": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["react"], "polarity": "positive"}],
                     "task": "some", "depth": "some"},
            "variant": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["react"], "polarity": "positive"},
                                     {"id": 2, "kind": "course", "concepts": [], "polarity": "positive"}],
                       "task": "some", "depth": "some"},
        },
        "relation": "equal_score",
    },
    {
        "id": "xf-added-ancestor-evidence-001", "family": "added-ancestor-evidence", "objectives": ["O05", "O06"],
        "critical": True, "kind": "scoring_pair", "mode": "recruiter",
        "atoms": [{"id": "t1", "kind": "tool", "concept": "pytorch", "required": True}],
        "candidates": {
            "base": {"evidence": [{"id": 1, "kind": "cv_project", "concepts": ["pytorch"], "polarity": "positive"}],
                     "task": "strong", "depth": "strong"},
            # Adding evidence for the broader area (machine-learning) on top
            # cannot satisfy — or inflate the score of — a specific tool
            # requirement the candidate already met.
            "variant": {"evidence": [{"id": 1, "kind": "cv_project", "concepts": ["pytorch"], "polarity": "positive"},
                                     {"id": 2, "kind": "cv_skill", "concepts": ["machine-learning"], "polarity": "positive"}],
                       "task": "strong", "depth": "strong"},
        },
        "relation": "equal_score",
    },
    # ── interchangeable tools inside an OR-group score equally ──────────
    {
        "id": "xf-tool-swap-001", "family": "tool-swap-equivalent", "objectives": ["O05", "O06"],
        "critical": True, "kind": "scoring_pair", "mode": "recruiter",
        "atoms": [{"id": "g1", "kind": "tool", "concept": "pytorch", "required": False, "group": "g1"},
                 {"id": "g2", "kind": "tool", "concept": "tensorflow", "required": False, "group": "g1"}],
        "candidates": {
            "base": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["pytorch"], "polarity": "positive"}],
                     "task": "some", "depth": "some"},
            "variant": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["tensorflow"], "polarity": "positive"}],
                       "task": "some", "depth": "some"},
        },
        "relation": "equal_score",
    },
    {
        "id": "xf-tool-swap-002", "family": "tool-swap-equivalent", "objectives": ["O05", "O06"],
        "critical": True, "kind": "scoring_pair", "mode": "network",
        "atoms": [{"id": "a1", "kind": "area", "concept": "deep-learning", "required": False}],
        "candidates": {
            "base": {"evidence": [{"id": 1, "kind": "cv_project", "concepts": ["pytorch", "deep-learning"], "polarity": "positive"}]},
            "variant": {"evidence": [{"id": 1, "kind": "cv_project", "concepts": ["tensorflow", "deep-learning"], "polarity": "positive"}]},
        },
        "relation": "equal_score",
    },
    # ── "not used" / "learning" polarity is never positive evidence ────
    {
        "id": "xf-aspirational-not-met-001", "family": "polarity-not-evidence", "objectives": ["O05", "O07"],
        "critical": True, "kind": "scoring_pair", "mode": "recruiter",
        "atoms": [{"id": "f1", "kind": "tool", "concept": "pytorch", "required": False}],
        "candidates": {
            "base": {"evidence": []},
            "variant": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["pytorch"], "polarity": "aspirational"}]},
        },
        "relation": "state_not_met", "atom_id": "f1",
    },
    {
        "id": "xf-negated-not-met-001", "family": "polarity-not-evidence", "objectives": ["O05", "O07"],
        "critical": True, "kind": "scoring_pair", "mode": "recruiter",
        "atoms": [{"id": "f1", "kind": "tool", "concept": "pytorch", "required": False}],
        "candidates": {
            "base": {"evidence": []},
            "variant": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["pytorch"], "polarity": "negative"}]},
        },
        "relation": "state_not_met", "atom_id": "f1",
    },
    # ── tightening a requirement never raises the score ─────────────────
    {
        "id": "xf-tighten-required-001", "family": "tighten-requirement", "objectives": ["O05", "O06"],
        "critical": True, "kind": "atoms_pair", "mode": "recruiter",
        "atoms_base": [{"id": "t1", "kind": "tool", "concept": "pytorch", "required": False}],
        "atoms_variant": [{"id": "t1", "kind": "tool", "concept": "pytorch", "required": True}],
        "candidate": {"evidence": [{"id": 1, "kind": "cv_skill", "concepts": ["pytorch"], "polarity": "positive"}],
                     "task": "some", "depth": "some"},
        "relation": "equal_score",  # met either way: tightening a met criterion changes tier risk, not the score
    },
    {
        "id": "xf-tighten-required-002", "family": "tighten-requirement", "objectives": ["O05", "O06"],
        "critical": True, "kind": "atoms_pair", "mode": "recruiter",
        "atoms_base": [{"id": "t1", "kind": "tool", "concept": "pytorch", "required": False}],
        "atoms_variant": [{"id": "t1", "kind": "tool", "concept": "pytorch", "required": True}],
        # Not evidenced at all — tightening an unmet criterion must never
        # raise the score (it cannot start scoring higher just because it
        # became mandatory).
        "candidate": {"evidence": [], "task": "some", "depth": "some"},
        "relation": "score_not_greater",
    },
    # ── paraphrase invariance: wording changes, extracted concepts don't ─
    {
        "id": "xf-paraphrase-001", "family": "paraphrase", "objectives": ["O01", "O02"], "critical": True,
        "kind": "interpret_pair", "mode": "recruiter",
        "message_a": "must have React, nice to have TypeScript",
        "message_b": "React is required; TypeScript would be nice",
        "relation": "same_concepts",
    },
    {
        "id": "xf-paraphrase-002", "family": "paraphrase", "objectives": ["O01", "O02"], "critical": True,
        "kind": "interpret_pair", "mode": "recruiter",
        "message_a": "PyTorch or TensorFlow", "message_b": "either PyTorch or TensorFlow is fine",
        "relation": "same_concepts",
    },
    {
        "id": "xf-paraphrase-003", "family": "paraphrase", "objectives": ["O01", "O02"], "critical": True,
        "kind": "interpret_pair", "mode": "network",
        "message_a": "deep learning and chess",
        "message_b": "people into deep learning who also enjoy chess",
        "relation": "same_concepts",
    },
    # ── a mode switch never carries a prior mode's disallowed criterion ──
    {
        "id": "xf-mode-switch-001", "family": "mode-switch-no-carryover", "objectives": ["O01", "O02"],
        "critical": True, "kind": "interpret_pair", "mode_a": "network", "mode_b": "opportunities",
        "message_a": "chess", "message_b": "chess",  # interest kind isn't in opportunities' allowed set
        "relation": "disjoint_concepts",
    },
    {
        "id": "xf-mode-switch-002", "family": "mode-switch-no-carryover", "objectives": ["O01", "O02"],
        "critical": True, "kind": "interpret_pair", "mode_a": "network", "mode_b": "recruiter",
        "message_a": "chess", "message_b": "chess",  # interest kind isn't in recruiter's allowed set either
        "relation": "disjoint_concepts",
    },
]


def build() -> list[dict]:
    return [{**c, "stage": "transform", "group": c["id"],
            "label_provenance": "drafted (Claude) from AI-evaluation-plan §5; pending human review"}
           for c in CASES]


if __name__ == "__main__":
    from pathlib import Path

    datasets = Path(__file__).resolve().parent.parent / "datasets"
    cases = build()
    (datasets / "transformations.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in cases) + "\n")
    families = {c["family"] for c in cases}
    print(f"wrote {len(cases)} transformation-pair cases across {len(families)} families -> {datasets}")
