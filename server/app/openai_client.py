"""One shared OpenAI client for the CV ingest worker.

Fetched once per process and cached — per cv-matchmaker-spec.md: "the API
key is fetched once at process startup, cached in memory, never re-fetched
per request." No fallback literal if OPENAI_API_KEY is missing;
worker_settings() already fails loud on that.
"""

from __future__ import annotations

import json
import os
import time
from functools import lru_cache
from types import SimpleNamespace
from typing import Any

from openai import OpenAI

from . import fake_provider
from .config import worker_settings

# ─── B2.8 load-test stub ────────────────────────────────────────────
# Only server/scripts/b28_load_test.py ever sets OPENAI_STUB_LATENCY_SECONDS
# — absent everywhere else, including prod/staging config, so this branch
# is dead code in every real deployment. Exists because B2.8 needs real
# `python -m app.worker` subprocesses (to exercise the actual claim/dispatch
# path under concurrency), which rules out patching client() in-process the
# way the C1 audit and the test suite do. Canned responses are the
# conservative ("select/exclude nothing") branch of each schema this
# process ever calls during a scan_github job, so a stubbed scan always
# takes the real code's normal fail-open/no-op path rather than a made-up
# result standing in for real judgment.
_STUB_RESPONSES: dict[str, dict[str, Any]] = {
    "repo_exclusions": {"excluded": []},
    "repo_shortlist": {"shortlist": []},
    "repo_selection": {"selected": [], "themes": []},
    "combined_summary": {"summary": "Stubbed summary — B2.8 load-test harness."},
}


class _StubChatCompletions:
    def __init__(self, latency: float) -> None:
        self._latency = latency

    def create(self, *, response_format: dict | None = None, **_kwargs: Any) -> Any:
        time.sleep(self._latency)
        schema_name = (response_format or {}).get("json_schema", {}).get("name")
        payload = _STUB_RESPONSES.get(schema_name, {})
        message = SimpleNamespace(content=json.dumps(payload))
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=None)


class _StubEmbeddings:
    def __init__(self, latency: float) -> None:
        self._latency = latency

    def create(self, *, input: Any = None, **_kwargs: Any) -> Any:
        time.sleep(self._latency)
        count = len(input) if isinstance(input, list) else 1
        data = [SimpleNamespace(embedding=[0.0] * 1536) for _ in range(count)]
        return SimpleNamespace(data=data, usage=None)


class _StubOpenAI:
    def __init__(self, latency: float) -> None:
        self.chat = SimpleNamespace(completions=_StubChatCompletions(latency))
        self.embeddings = _StubEmbeddings(latency)


# A0.1 (AI-plan §9, F6): an explicit timeout and no SDK retries. The SDK
# default (two silent retries on 429/5xx) made every call up to three
# billable attempts with nothing in the ledger knowing; a retry is now a
# decision the job queue makes, with its own backoff and its own
# reservation. Ingestion is background work, so the timeout is generous.
REQUEST_TIMEOUT_SECONDS = 90.0


@lru_cache(maxsize=1)
def client() -> OpenAI:
    stub_latency = os.environ.get("OPENAI_STUB_LATENCY_SECONDS")
    if stub_latency is not None:
        return _StubOpenAI(float(stub_latency))  # type: ignore[return-value]
    if fake_provider.enabled():
        # Local and E2E only: refuses unless the database is on this machine.
        fake_provider.assert_local(worker_settings().database_url)
        return fake_provider.FakeOpenAI()  # type: ignore[return-value]
    return OpenAI(api_key=worker_settings().openai_api_key, timeout=REQUEST_TIMEOUT_SECONDS, max_retries=0)
