"""Source for datasets/memory.jsonl (S5 gap 6, O09). Run:
python -m evals.authoring.memory

Gold pairs for the keyword-vs-hybrid memory benchmark (evals/memory_bench.py).
Each case is one owner's two-turn conversation: an EARLIER message (whose
text gets embedded and stored as chat memory) and a LATER message that
should recall it. The fake provider's embedding is bag-of-words, not real
semantic similarity (see test_ai_memory.py's own docstring), so a
"paraphrase" here still shares enough words with the earlier message for
the fake's vector to land close — these are not held to recognising true
synonyms, only to the same hybrid-vs-keyword-only distinction
test_ai_memory.py's one hardcoded example already demonstrates, generalised
to more cases.

should_recall=False cases are distractors: an unrelated earlier message
that a hybrid search must NOT drag in just because nearest-twelve has no
floor (mirrors test_ai_memory.py's "nearest-twelve without a floor would
drag this in").
"""

from __future__ import annotations

import json

# (id, earlier, later, should_recall)
CASES: list[tuple[str, str, str, bool]] = [
    ("mem-001", "Looking for a computer vision researcher who uses PyTorch",
     "the computer vision researcher from before", True),
    ("mem-002", "Need a backend engineer who knows Django and PostgreSQL",
     "that backend engineer who knew Django, remind me who it was", True),
    ("mem-003", "Trying to find someone into climbing and chess",
     "the climbing and chess person we found earlier", True),
    ("mem-004", "Searching for a Figma designer for the landing page",
     "the Figma designer from our last chat", True),
    ("mem-005", "Want to meet a robotics hardware person who's built drones",
     "that robotics hardware person who built drones", True),
    ("mem-006", "Looking for a data engineer who has used Kafka and Airflow",
     "the data engineer with Kafka experience from before", True),
    ("mem-007", "Need someone who knows Terraform and AWS for infra work",
     "the Terraform and AWS person from earlier", True),
    ("mem-008", "Interested in a biochemistry researcher doing CRISPR work",
     "the biochemistry researcher we discussed", True),
    # distractors: an unrelated earlier message that must NOT surface for
    # an unrelated later query, even though chat memory has no floor.
    ("mem-009", "chess club on tuesdays", "deep learning people with PyTorch experience", False),
    ("mem-010", "looking for a rowing partner", "need a Kafka and Airflow data engineer", False),
]


def build() -> list[dict]:
    return [{"id": cid, "family": "memory-recall" if recall else "memory-distractor",
            "objectives": ["O09"], "critical": True, "earlier": earlier, "later": later,
            "should_recall": recall, "group": cid,
            "label_provenance": "drafted (Claude) from the pattern in test_ai_memory.py; pending human review"}
           for cid, earlier, later, recall in CASES]


if __name__ == "__main__":
    from pathlib import Path

    datasets = Path(__file__).resolve().parent.parent / "datasets"
    cases = build()
    (datasets / "memory.jsonl").write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in cases) + "\n")
    print(f"wrote {len(cases)} memory cases "
          f"({sum(c['should_recall'] for c in cases)} recall / {sum(not c['should_recall'] for c in cases)} distractor) "
          f"-> {datasets}")
