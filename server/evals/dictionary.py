"""The concept dictionary as a versioned fixture, so offline evals need no
database. Refresh after any dictionary migration:

    python -m evals export-dictionary --dsn postgresql://postgres:postgres@127.0.0.1:54322/postgres

The export is the same rows ai_private.worker_concepts() returns.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.concepts import Dictionary

PATH = Path(__file__).resolve().parent / "datasets" / "dictionary.json"


def export(dsn: str) -> int:
    import psycopg

    with psycopg.connect(dsn) as conn:
        concepts = conn.execute(
            "select slug, label, kind, aliases, ambiguous, dictionary_version from ai_private.concepts order by slug"
        ).fetchall()
        relations = conn.execute(
            "select from_slug, to_slug, relation, weight::float from ai_private.concept_relations order by 1, 2, 3"
        ).fetchall()
    PATH.write_text(json.dumps({
        "version": max((c[5] for c in concepts), default=1),
        "concepts": [list(c[:5]) for c in concepts],
        "relations": [list(r) for r in relations],
    }, indent=0, sort_keys=True))
    return len(concepts)


@lru_cache(maxsize=1)
def load() -> Dictionary:
    data = json.loads(PATH.read_text())
    return Dictionary.from_rows([tuple(c) for c in data["concepts"]], [tuple(r) for r in data["relations"]],
                                version=data["version"])
