"""S4 gap 10: a transport-level egress test. test_egress_inventory.py
proves every provider call site is metered and listed; this proves the
*bytes that actually leave the process* at each of those sites are clean.

httpx2.MockTransport (openai 3.x bundles its own httpx fork under that
name — see test_github_pipeline.py) is wired into a real OpenAI/AsyncOpenAI
client, so the SDK does its normal JSON serialisation and the handler
sees exactly what a real HTTP request would carry. Each site is driven
with planted PII (a name, an email, a phone number, a URL, a secret-
looking token) run through the same minimisation the real caller applies
(worker.py's `privacy.minimise` before CV calls, `projection.py`'s before
parse_requirements, `ledger.outbound` before GitHub calls, and
pipeline.py's `privacy.assert_clean` before the executor), and the
captured request body is asserted clean. A forced 429/5xx is also
checked: the exception the SDK raises must not echo the request payload.

No network ever leaves the process — the mock transport never connects
anywhere — so this needs no API key and no database.
"""

from __future__ import annotations

import json
import uuid

import httpx2
import pytest
from openai import AsyncOpenAI, OpenAI, RateLimitError

from app import ledger, privacy
from app.ai.provider import OpenAIProvider

PII = {
    "name": "Jordan Alvarez",
    "email": "jordan.alvarez@example.com",
    "phone": "+44 7700 900123",
    "url": "https://github.com/jordanalvarez",
    "secret": "sk-test-abcdefghijklmnopqrstuvwxyz0123456789",
}


def _dirty_text(label: str) -> str:
    return (f"{label} by {PII['name']} ({PII['email']}, {PII['phone']}). "
            f"See {PII['url']}. Do not leak {PII['secret']}.")


def _capturing_client(response_json: dict) -> tuple[OpenAI, list[bytes]]:
    captured: list[bytes] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        captured.append(request.read())
        return httpx2.Response(200, json=response_json)

    client = OpenAI(api_key="test", http_client=httpx2.Client(transport=httpx2.MockTransport(handler)))
    return client, captured


def _erroring_client(status: int) -> tuple[OpenAI, list[bytes]]:
    captured: list[bytes] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        captured.append(request.read())
        return httpx2.Response(status, json={"error": {"message": "forced failure", "type": "server_error"}})

    client = OpenAI(api_key="test", http_client=httpx2.Client(transport=httpx2.MockTransport(handler)))
    return client, captured


def _assert_request_clean(captured: list[bytes]) -> None:
    assert captured, "the handler was never called"
    for body in captured:
        text = body.decode()
        for value in PII.values():
            assert value not in text, f"{value!r} leaked in the outbound request: {text[:300]}"
        privacy.assert_clean(text)


# ─── cv_pipeline.extract_profile / moderation.moderate_cv ──────────────
# worker.py:355 minimises raw CV text before passing it to either.

def test_cv_extraction_and_moderation_requests_are_clean(monkeypatch):
    from app import cv_pipeline, moderation

    ids = privacy.Identifiers(names=(PII["name"],), exact=(PII["email"], PII["url"]))
    outbound = privacy.minimise(_dirty_text("CV"), ids).text

    extract_client, extract_captured = _capturing_client({
        "id": "chatcmpl-1", "object": "chat.completion", "created": 0, "model": cv_pipeline.EXTRACTION_MODEL,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": json.dumps({
            "education": [], "roles": [], "projects": [], "skills_raw": [], "languages": [], "links": [],
            "summary": "ok",
        })}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    })
    monkeypatch.setattr(cv_pipeline, "client", lambda: extract_client)
    cv_pipeline.extract_profile(outbound)
    _assert_request_clean(extract_captured)

    mod_client, mod_captured = _capturing_client({
        "id": "modr-1", "model": moderation.MODERATION_MODEL,
        "results": [{"flagged": False, "categories": {}, "category_scores": {}, "category_applied_input_types": {}}],
    })
    monkeypatch.setattr(moderation, "client", lambda: mod_client)
    moderation.moderate_cv(outbound)
    _assert_request_clean(mod_captured)


# ─── cv_pipeline._embed ─────────────────────────────────────────────────

def test_cv_embedding_requests_are_clean(monkeypatch):
    from app import cv_pipeline

    ids = privacy.Identifiers(names=(PII["name"],), exact=(PII["email"], PII["url"]))
    outbound = privacy.minimise(_dirty_text("chunk"), ids).text
    client, captured = _capturing_client({
        "object": "list", "model": cv_pipeline.EMBEDDING_MODEL,
        "data": [{"object": "embedding", "index": 0, "embedding": [0.0] * 5}],
        "usage": {"prompt_tokens": 1, "total_tokens": 1},
    })
    monkeypatch.setattr(cv_pipeline, "client", lambda: client)
    cv_pipeline._embed([outbound])
    _assert_request_clean(captured)


# ─── projection.parse_requirements ──────────────────────────────────────
# projection.py:431 minimises the raw job description the same way.

def test_job_requirements_parsing_request_is_clean(monkeypatch):
    from app import projection
    from app.concepts import Dictionary

    ids = privacy.Identifiers(names=(PII["name"],), exact=(PII["email"], PII["url"]))
    description = privacy.minimise(_dirty_text("Hiring"), ids, max_chars=5000).text
    client, captured = _capturing_client({
        "id": "chatcmpl-2", "object": "chat.completion", "created": 0, "model": projection.REQUIREMENTS_MODEL,
        "choices": [{"index": 0, "message": {"role": "assistant",
                    "content": json.dumps({"atoms": [], "role_level": "unspecified"})}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    })
    monkeypatch.setattr(projection, "client", lambda: client)
    d = Dictionary.from_rows([], [])
    projection.parse_requirements(description, "Analyst", [], d)
    _assert_request_clean(captured)


# ─── github_pipeline: ledger.outbound before every repo payload ────────

def test_github_shortlist_request_is_clean(monkeypatch):
    from app import github_pipeline

    client, captured = _capturing_client({
        "id": "chatcmpl-3", "object": "chat.completion", "created": 0, "model": github_pipeline.EXTRACTION_MODEL,
        "choices": [{"index": 0, "message": {"role": "assistant",
                    "content": json.dumps({"shortlist": []})}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    })
    monkeypatch.setattr(github_pipeline, "client", lambda: client)
    ids = privacy.Identifiers(names=(PII["name"],), exact=(PII["email"], PII["url"]))
    with ledger.job_context(uuid.uuid4(), uuid.uuid4(), ids):
        github_pipeline._shortlist_by_metadata([
            {"name": "my-repo", "description": _dirty_text("A repo"), "language": "Python", "stargazers_count": 3},
        ])
    _assert_request_clean(captured)


# ─── the AI executor's own provider, outside the fake ──────────────────
# pipeline.py's metered_json already calls privacy.assert_clean on the
# assembled payload before this layer; this proves the real SDK call
# sends exactly that payload (no extra field reintroduces anything) and
# that embeddings go out the same way.

def test_executor_json_and_embed_requests_are_clean():
    provider = OpenAIProvider(api_key="test")
    ids = privacy.Identifiers(names=(PII["name"],), exact=(PII["email"], PII["url"]))
    clean_user = privacy.minimise(_dirty_text("message"), ids).text
    schema = {"type": "object", "additionalProperties": False, "required": ["decision", "ops"],
              "properties": {"decision": {"type": "string"}, "ops": {"type": "array"}}}
    captured: list[bytes] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        captured.append(request.read())
        return httpx2.Response(200, json={
            "id": "resp_1", "object": "response", "created_at": 0, "status": "completed", "model": "gpt-5.4-mini",
            "output": [{"type": "message", "id": "m1", "status": "completed", "role": "assistant",
                       "content": [{"type": "output_text",
                                   "text": json.dumps({"decision": "clarify", "ops": []}), "annotations": []}]}],
            "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
        })

    provider._client = AsyncOpenAI(api_key="test", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    import asyncio
    asyncio.run(provider.json(uuid.uuid4(), model="gpt-5.4-mini", name="interpretation", system="sys",
                              user=clean_user, schema=schema, max_output_tokens=50, timeout=5))
    _assert_request_clean(captured)

    captured.clear()

    def embed_handler(request: httpx2.Request) -> httpx2.Response:
        captured.append(request.read())
        return httpx2.Response(200, json={"object": "list", "model": "text-embedding-3-small",
                                         "data": [{"object": "embedding", "index": 0, "embedding": [0.0] * 5}],
                                         "usage": {"prompt_tokens": 1, "total_tokens": 1}})

    provider._client = AsyncOpenAI(api_key="test", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(embed_handler)))
    asyncio.run(provider.embed(uuid.uuid4(), model="text-embedding-3-small", texts=[clean_user], timeout=5))
    _assert_request_clean(captured)


# ─── forced provider errors never echo the request payload ────────────
# Below the SDK: a raw 429 from the real client, with no ledger.metered
# in front of it, to check the SDK's own error formatting doesn't echo
# what we just sent (it reports the server's error body, not ours).

def test_a_raw_sdk_rate_limit_error_message_carries_no_payload(monkeypatch):
    from app import github_pipeline

    client, captured = _erroring_client(429)
    monkeypatch.setattr(github_pipeline, "client", lambda: client)
    with pytest.raises(RateLimitError) as excinfo:
        client.chat.completions.create(
            model=github_pipeline.EXTRACTION_MODEL,
            messages=[{"role": "user", "content": _dirty_text("leaked if echoed")}],
        )
    for value in PII.values():
        assert value not in str(excinfo.value)
    assert captured  # the request was sent — this test is about the response side only


def test_the_metering_boundary_refuses_a_dirty_payload_before_any_request_is_sent(monkeypatch):
    """Through the real call site (_create_chat_completion → ledger.metered),
    not the raw SDK: a payload that still carries PII never reaches the
    transport at all — ledger.metered's own `privacy.assert_clean` is a
    second line of defence behind the caller's minimisation, and it fires
    here even though the handler would have raised a rate limit too."""
    from app import github_pipeline

    client, captured = _erroring_client(429)
    monkeypatch.setattr(github_pipeline, "client", lambda: client)
    ids = privacy.Identifiers(names=(PII["name"],), exact=(PII["email"],))
    with ledger.job_context(uuid.uuid4(), uuid.uuid4(), ids):
        with pytest.raises(privacy.OutboundPolicyError) as excinfo:
            github_pipeline._create_chat_completion(
                model=github_pipeline.EXTRACTION_MODEL,
                messages=[{"role": "user", "content": json.dumps({"description": _dirty_text("job")})}],
                response_format={"type": "json_schema",
                                 "json_schema": {"name": "repo_shortlist", "strict": True,
                                                "schema": github_pipeline._SHORTLIST_SCHEMA}},
            )
    assert not captured, "no HTTP request should have been made"
    for value in PII.values():
        assert value not in str(excinfo.value)
