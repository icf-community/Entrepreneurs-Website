"""One-time download of the full ESCO skills taxonomy (~13,500 concepts)
into the same CSV shape seed_skills.py already reads (`canonical_name`,
`esco_uri`), as a drop-in replacement for the small hand-picked
skills_seed.csv used for the first pipeline test.

Pulls from the public ESCO REST API (no API key needed):
https://ec.europa.eu/esco/api/search, filtered to the "skills" concept
scheme, English labels. `offset` in this API is a PAGE index, not a
record offset (confirmed empirically — offset=1 with limit=5 returns
records 5-9, not 1-5), so pages are walked as offset=0..N with a fixed
limit rather than by accumulating a running record count.

Run once, no venv extras needed beyond `requests` (already in
requirements.txt): `python scripts/fetch_esco_skills.py`. Writes
scripts/esco_skills_full.csv. Safe to re-run — just overwrites the file.
"""

from __future__ import annotations

import csv
import time
from pathlib import Path

import requests

API = "https://ec.europa.eu/esco/api/search"
SKILLS_SCHEME = "http://data.europa.eu/esco/concept-scheme/skills"
LIMIT = 500
OUTPUT_CSV = Path(__file__).parent / "esco_skills_full.csv"
_REQUEST_TIMEOUT_SECONDS = 30
# Courtesy pause between pages — this is a public EU government API with no
# published rate limit; ~30 requests for the full taxonomy is cheap enough
# that a small delay costs nothing and is good citizenship.
_PAUSE_SECONDS = 0.2


def fetch_all() -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    seen_uris: set[str] = set()
    offset = 0
    while True:
        response = requests.get(
            API,
            params={
                "text": "",
                "language": "en",
                "type": "skill",
                "isInScheme": SKILLS_SCHEME,
                "limit": LIMIT,
                "offset": offset,
            },
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        body = response.json()
        results = body["_embedded"]["results"]
        if not results:
            break

        for result in results:
            uri = result["uri"]
            if uri in seen_uris:
                continue
            seen_uris.add(uri)
            label = result.get("preferredLabel", {}).get("en") or result["title"]
            rows.append((label, uri))

        print(f"  fetched page offset={offset} ({len(rows)}/{body['total']})")
        if len(rows) >= body["total"]:
            break
        offset += 1
        time.sleep(_PAUSE_SECONDS)

    return rows


def main() -> None:
    print("Downloading full ESCO skills taxonomy from the public ESCO API...")
    rows = fetch_all()
    rows.sort(key=lambda r: r[0].lower())

    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["canonical_name", "esco_uri"])
        writer.writerows(rows)

    print(f"Wrote {len(rows)} skills to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
