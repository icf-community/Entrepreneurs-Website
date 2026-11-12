"""Executor configuration. Separate from config.WorkerSettings on purpose
(AI-plan §4): the AI image needs none of the worker's storage, GitHub or
database credentials, and must refuse to start without its own.

Every required value fails loud. AI_PROVIDER=fake swaps in the
deterministic provider and refuses any database that is not local.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from ..config import MissingConfig, _required
from .. import fake_provider


@dataclass(frozen=True)
class AiSettings:
    database_url: str
    provider: str  # "openai" | "fake"
    openai_api_key: str | None
    interpreter_model: str
    assessor_models: dict[str, str]
    embedding_model: str
    workers: int
    poll_seconds: float


@lru_cache(maxsize=1)
def ai_settings() -> AiSettings:
    database_url = _required("AI_DATABASE_URL")
    provider = os.environ.get("AI_PROVIDER", "openai").lower()
    if provider not in ("openai", "fake"):
        raise MissingConfig(f"AI_PROVIDER must be openai or fake, not {provider!r}")
    if provider == "fake":
        fake_provider.assert_local(database_url)
        return AiSettings(
            database_url=database_url,
            provider="fake",
            openai_api_key=None,
            interpreter_model="fake-mini",
            assessor_models={"recruiter": "fake-large", "network": "fake-mini", "opportunities": "fake-mini"},
            embedding_model="fake-embedding",
            workers=int(os.environ.get("AI_WORKERS", "2")),
            poll_seconds=float(os.environ.get("AI_POLL_SECONDS", "0.5")),
        )
    return AiSettings(
        database_url=database_url,
        provider="openai",
        # The matching project's own key, never the ingestion worker's.
        openai_api_key=_required("AI_OPENAI_API_KEY"),
        interpreter_model=os.environ.get("AI_INTERPRETER_MODEL", "gpt-5.4-mini"),
        assessor_models={
            "recruiter": os.environ.get("AI_RECRUITER_ASSESSOR_MODEL", "gpt-6.1-sol"),
            "network": os.environ.get("AI_NETWORK_ASSESSOR_MODEL", "gpt-5.4-mini"),
            "opportunities": os.environ.get("AI_OPPORTUNITIES_ASSESSOR_MODEL", "gpt-5.4-mini"),
        },
        embedding_model=os.environ.get("AI_EMBEDDING_MODEL", "text-embedding-3-small"),
        workers=int(os.environ.get("AI_WORKERS", "4")),
        poll_seconds=float(os.environ.get("AI_POLL_SECONDS", "1.0")),
    )
