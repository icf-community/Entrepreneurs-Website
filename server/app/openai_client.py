"""One shared OpenAI client for the CV ingest worker.

Fetched once per process and cached — per cv-matchmaker-spec.md: "the API
key is fetched once at process startup, cached in memory, never re-fetched
per request." No fallback literal if OPENAI_API_KEY is missing;
worker_settings() already fails loud on that.
"""

from __future__ import annotations

from functools import lru_cache

from openai import OpenAI

from .config import worker_settings


@lru_cache(maxsize=1)
def client() -> OpenAI:
    return OpenAI(api_key=worker_settings().openai_api_key)
