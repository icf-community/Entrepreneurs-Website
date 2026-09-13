"""One-time load of the skills taxonomy that normalise_skills matches
against (cv-matchmaker-spec.md, step 5).

This seeds skills_seed.csv — a small (~180 entry) hand-picked list, not
the full ~13,000-entry ESCO taxonomy — chosen for a first local
end-to-end test of the pipeline rather than production coverage. To
switch to the real ESCO download later, no code changes are needed: drop
a CSV with the same single `canonical_name` column (an `esco_uri` column
is also read if present) at a different path and pass it as the argument
below.

Run once against a running Postgres (local Supabase: `supabase start`,
then, from `server/` with the venv active and DATABASE_URL/
OPENAI_API_KEY exported, `python scripts/seed_skills.py` — relies on
`app` being importable via the editable install from server/README.md's
setup, not on scripts/ being a package). Safe to re-run: existing
canonical names are left alone (`on conflict (canonical_name) do
nothing`), so re-running after adding new rows to the CSV only inserts
the new ones.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

from app.config import worker_settings
from app.db import connection
from app.cv_pipeline import EMBEDDING_MODEL, vector_literal
from app.openai_client import client

DEFAULT_CSV = Path(__file__).parent / "skills_seed.csv"

# The embeddings endpoint accepts many inputs per call — batching in
# chunks of a few hundred is the spec's own guidance for the one-time
# ESCO load, so the same batching is used here even for this much
# smaller seed list.
BATCH_SIZE = 200


def _load_rows(csv_path: Path) -> list[tuple[str, str | None]]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            name = row["canonical_name"].strip()
            if not name:
                continue
            esco_uri = (row.get("esco_uri") or "").strip() or None
            rows.append((name, esco_uri))
        return rows


def seed(csv_path: Path = DEFAULT_CSV) -> int:
    worker_settings()  # fail loud immediately if OPENAI_API_KEY/DATABASE_URL are missing
    rows = _load_rows(csv_path)
    inserted = 0

    with connection() as conn, conn.cursor() as cur:
        for start in range(0, len(rows), BATCH_SIZE):
            batch = rows[start : start + BATCH_SIZE]
            names = [name for name, _ in batch]
            response = client().embeddings.create(model=EMBEDDING_MODEL, input=names)
            for (name, esco_uri), item in zip(batch, response.data):
                cur.execute(
                    """
                    insert into public.cv_skills (canonical_name, esco_uri, embedding)
                    values (%s, %s, %s::vector)
                    on conflict (canonical_name) do nothing
                    """,
                    (name, esco_uri, vector_literal(item.embedding)),
                )
                inserted += cur.rowcount

    return inserted


if __name__ == "__main__":
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    count = seed(csv_path)
    print(f"Inserted {count} new skill(s) from {csv_path}")
