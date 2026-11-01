"""What the executor does when OpenAI refuses for budget or account reasons.

The owner runs a monthly budget in the OpenAI dashboard as the outer wall behind
the database ledger. When it is hit, OpenAI answers 429 (insufficient_quota) or
400 (billing_hard_limit_reached); a revoked key answers 401. None of those may:

  * reach the member as raw provider text (the member only ever sees the generic
    "unavailable" outcome, mapped in pipeline.py from the ProviderError outcome);
  * be retried inside the SDK (max_retries=0: each attempt is a ledger reservation);
  * be mistaken for an invalid model answer.

The first two are pinned here at the one place that talks to OpenAI. The mapping
of outcome to member-visible status is pinned in tests/integration/test_ai_faults.py.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import httpx2
import pytest
from openai import AsyncOpenAI

from app.ai.provider import OpenAIProvider, ProviderError
from app.ai.schemas import INTERPRET_SCHEMA, prompt

PROVIDER_TEXT = "You exceeded your current quota, please check your plan and billing details. org-SECRETORG"


def _provider(status: int, code: str, calls: list[int]) -> OpenAIProvider:
    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        return httpx2.Response(status, json={"error": {"message": PROVIDER_TEXT, "type": code, "code": code}})

    provider = OpenAIProvider("test-key-not-real")
    # Same construction as the real client (no SDK retries), over a mock transport.
    provider._client = AsyncOpenAI(
        api_key="test", max_retries=0, http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    )
    return provider


def _call(provider: OpenAIProvider) -> None:
    asyncio.run(
        provider.json(
            uuid.uuid4(), model="gpt-5.4-mini", name="interpretation", system=prompt("interpret"),
            user=json.dumps({"mode": "network", "message": "python", "current_criteria": [],
                             "candidate_concepts": [], "memory": []}),
            schema=INTERPRET_SCHEMA, max_output_tokens=1500, timeout=5,
        )
    )


@pytest.mark.parametrize(
    "status,code,outcome",
    [
        (429, "insufficient_quota", "rate_limit"),      # the monthly budget is spent
        (429, "rate_limit_exceeded", "rate_limit"),     # ordinary throttling
        (400, "billing_hard_limit_reached", "provider_error"),
        (401, "invalid_api_key", "provider_error"),     # the key was revoked or rotated
        (403, "unsupported_country_region_territory", "provider_error"),
        (500, "server_error", "server_error"),
        (503, "overloaded", "server_error"),
    ],
)
def test_a_refusal_becomes_one_named_outcome_with_no_provider_text(status: int, code: str, outcome: str) -> None:
    calls: list[int] = []
    with pytest.raises(ProviderError) as excinfo:
        _call(_provider(status, code, calls))
    assert excinfo.value.outcome == outcome
    # The text that could reach a log line or a member (the outcome is all that survives).
    assert PROVIDER_TEXT not in str(excinfo.value)
    assert "SECRETORG" not in repr(excinfo.value)
    # One request per attempt: the SDK must not retry on its own (every attempt is a reservation).
    assert len(calls) == 1


def test_embedding_refusals_map_the_same_way() -> None:
    calls: list[int] = []
    provider = _provider(429, "insufficient_quota", calls)
    with pytest.raises(ProviderError) as excinfo:
        asyncio.run(provider.embed(uuid.uuid4(), model="text-embedding-3-small", texts=["python"], timeout=5))
    assert excinfo.value.outcome == "rate_limit"
    assert len(calls) == 1
