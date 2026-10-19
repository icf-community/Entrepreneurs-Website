"""Model providers for the executor.

OpenAIProvider is the only code in the executor that talks to OpenAI, and
its one SDK entry point (_call) takes a reservation id: callers reserve
in the ledger first (budget.py), and test_egress_inventory.py fails if any
other call site appears. Responses API, store=False, strict JSON schema,
an explicit per-attempt timeout, max_output_tokens, no tools and no SDK
retries (AI-plan §4, §9).

FakeProvider answers the same requests deterministically from the payload,
for local runs, E2E and the offline eval harness. It is only constructed
when AI_PROVIDER=fake, which refuses any non-local database.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass

from .. import fake_provider
from ..schema_validate import SchemaError, validate


class ProviderError(Exception):
    def __init__(self, outcome: str, message: str = "") -> None:
        super().__init__(message or outcome)
        self.outcome = outcome  # refused | invalid_output | timeout | provider_error


@dataclass
class JsonResult:
    value: dict
    input_tokens: int
    output_tokens: int


@dataclass
class EmbedResult:
    vectors: list[list[float]]
    input_tokens: int


class OpenAIProvider:
    def __init__(self, api_key: str) -> None:
        from openai import AsyncOpenAI

        # Per-attempt timeouts are passed on each call; SDK retries are off.
        self._client = AsyncOpenAI(api_key=api_key, max_retries=0, timeout=30.0)

    async def _call(self, reservation: uuid.UUID, kind: str, **kwargs):  # noqa: ANN202
        import openai

        assert reservation is not None, "a provider call needs a ledger reservation"
        try:
            if kind == "json":
                return await self._client.responses.create(**kwargs)
            return await self._client.embeddings.create(**kwargs)
        except openai.APITimeoutError as exc:
            raise ProviderError("timeout") from exc
        except openai.RateLimitError as exc:
            raise ProviderError("rate_limit") from exc
        except openai.APIError as exc:
            raise ProviderError("server_error" if getattr(exc, "status_code", 0) and exc.status_code >= 500 else "provider_error") from exc

    async def json(
        self, reservation: uuid.UUID, *, model: str, name: str, system: str, user: str, schema: dict,
        max_output_tokens: int, timeout: float,
    ) -> JsonResult:
        response = await self._call(
            reservation,
            "json",
            model=model,
            instructions=system,
            input=user,
            store=False,
            max_output_tokens=max_output_tokens,
            text={"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}},
            timeout=timeout,
        )
        usage = getattr(response, "usage", None)
        in_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        out_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        if getattr(response, "status", "completed") != "completed":
            raise ProviderError("invalid_output", "incomplete response")
        for item in getattr(response, "output", None) or []:
            for part in getattr(item, "content", None) or []:
                if getattr(part, "type", "") == "refusal":
                    raise ProviderError("refused")
        try:
            value = json.loads(response.output_text)
            validate(value, schema)
        except (json.JSONDecodeError, SchemaError, TypeError) as exc:
            raise ProviderError("invalid_output", type(exc).__name__) from exc
        return JsonResult(value, in_tokens, out_tokens)

    async def embed(self, reservation: uuid.UUID, *, model: str, texts: list[str], timeout: float) -> EmbedResult:
        response = await self._call(reservation, "embed", model=model, input=texts, timeout=timeout)
        usage = getattr(response, "usage", None)
        return EmbedResult([item.embedding for item in response.data], int(getattr(usage, "prompt_tokens", 0) or 0))


# ─── The fake ───────────────────────────────────────────────────────
_OFF_TASK = re.compile(
    r"(?:^|\b(?:and|also|then|but)\s+|[,;.]\s*)(explain|what is|what's|what are|why|how do|how does|how to|write|"
    r"solve|calculate|compute|summari[sz]e|translate|tell me|give me a|define|prove)\b|"
    r"\b(write (?:me )?(?:a |some )?(?:code|function|essay|poem|script)|reverse a linked list|homework|joke)\b",
    re.I,
)
_SEARCH = re.compile(r"\b(find|people|someone|somebody|anyone|members?|candidates?|who|jobs?|roles?|internships?|"
                     r"looking for|collaborators?|co-?founders?|mentors?|experts?|with)\b", re.I)
_INJECTION = re.compile(r"\b(ignore (?:all |any |the )?(?:previous |prior |above )?instructions|system prompt|"
                        r"you are now|disregard|jailbreak|developer mode)\b", re.I)
_SENSITIVE = re.compile(r"\b(age|aged|young|old|gender|male|female|women|men|ethnic\w*|race|nationality|religio\w*|"
                        r"muslim|christian|jewish|hindu|gay|straight|disab\w*|pregnan\w*|married)\b", re.I)
_REQUIRED = re.compile(r"\b(must|need|needs|required|essential|only)\b[^.;,]{0,40}$", re.I)
_NEGATED = re.compile(r"\b(not|no|without|excluding|except)\b[^.;,]{0,25}$", re.I)


class FakeProvider:
    """The deterministic fake, with optional fault injection for local
    failure-mode testing (S4). `fault` is one of: timeout_after_success,
    rate_limit, server_error, invalid_output, slow(<ms>), crash_before,
    crash_after — or None for normal behaviour. Only ever constructed
    behind AI_PROVIDER=fake, which already refuses a non-local database
    (config.py), so this needs no extra guard of its own."""

    def __init__(self, fault: str | None = None) -> None:
        self.fault = fault
        self.calls = 0

    async def _inject(self) -> None:
        self.calls += 1
        fault = self.fault
        if fault is None:
            return
        if fault == "crash_before":
            raise RuntimeError("fault injection: crash_before")
        if fault.startswith("slow(") and fault.endswith(")"):
            import asyncio
            await asyncio.sleep(int(fault[len("slow("):-1]) / 1000)
            return
        if fault == "timeout_after_success":
            raise ProviderError("timeout")
        if fault == "rate_limit":
            raise ProviderError("rate_limit")
        if fault == "server_error":
            raise ProviderError("server_error")
        # invalid_output and crash_after act after the fake has computed its
        # answer (below), since both represent the provider having actually
        # done the work.

    async def json(
        self, reservation: uuid.UUID, *, model: str, name: str, system: str, user: str, schema: dict,
        max_output_tokens: int, timeout: float,
    ) -> JsonResult:
        assert reservation is not None
        await self._inject()
        payload = json.loads(user)
        if name == "interpretation":
            value = _fake_interpret(payload)
        elif name in ("assessment", "job_assessment"):
            value = _fake_assess(payload, jobs=name == "job_assessment")
        else:
            raise ProviderError("invalid_output", name)
        if self.fault == "invalid_output":
            raise ProviderError("invalid_output", "fault injection")
        if self.fault == "crash_after":
            raise RuntimeError("fault injection: crash_after")
        validate(value, schema)
        return JsonResult(value, max(1, len(user) // 4), max(1, len(json.dumps(value)) // 4))

    async def embed(self, reservation: uuid.UUID, *, model: str, texts: list[str], timeout: float) -> EmbedResult:
        assert reservation is not None
        await self._inject()
        if self.fault in ("invalid_output", "crash_after"):
            raise RuntimeError("fault injection: crash_after") if self.fault == "crash_after" \
                else ProviderError("invalid_output", "fault injection")
        return EmbedResult([fake_provider.embed(t) for t in texts], max(1, sum(len(t) for t in texts) // 4))


def _fake_interpret(payload: dict) -> dict:
    message: str = payload.get("message") or ""
    if _INJECTION.search(message):
        return {"decision": "injection", "ops": []}
    if _SENSITIVE.search(message):
        return {"decision": "sensitive", "ops": []}
    ops = []
    lower = message.lower()
    for concept in payload.get("candidate_concepts", []):
        slug = concept["slug"]
        start = int(concept.get("start", -1))
        before = lower[max(0, start - 45): start] if start >= 0 else ""
        ops.append({
            "op": "add", "kind": concept.get("kind"), "concept": slug, "free_text": None,
            "span_start": None, "span_end": None,
            "required": bool(_REQUIRED.search(before)), "negated": bool(_NEGATED.search(before)),
            "group": None, "atom": None,
        })
    off_task = bool(_OFF_TASK.search(message))
    if off_task and ops and _SEARCH.search(message):
        return {"decision": "mixed", "ops": ops}
    if off_task:
        return {"decision": "off_task", "ops": []}
    if not ops:
        return {"decision": "clarify", "ops": []}
    return {"decision": "apply", "ops": ops}


def _level(n: int) -> str:
    return "strong" if n >= 3 else "some" if n >= 1 else "none"


def _fake_assess(payload: dict, *, jobs: bool) -> dict:
    out = []
    if jobs:
        evidence = payload.get("member_evidence", [])
        for job in payload.get("jobs", []):
            out.append(_fake_candidate(job["ref"], job.get("criteria", []), evidence))
    else:
        for cand in payload.get("candidates", []):
            out.append(_fake_candidate(cand["ref"], payload.get("criteria", []), cand.get("evidence", [])))
    return {"candidates": out}


def _fake_candidate(ref: str, criteria: list[dict], evidence: list[dict]) -> dict:
    atoms = []
    for c in criteria:
        if c.get("kind") != "free":
            continue
        words = [w for w in re.findall(r"[a-z0-9+#]+", (c.get("label") or "").lower()) if len(w) > 2]
        hits = [e["ref"] for e in evidence if words and all(w in e["text"].lower() for w in words)]
        atoms.append({"atom": c["ref"], "state": "met" if hits else "unknown", "evidence": hits[:2]})
    work = [e for e in evidence if e.get("kind") in ("cv_project", "cv_role", "github_repo", "job")]
    return {
        "ref": ref,
        "atoms": atoms,
        "task": _level(len(work)),
        "depth": _level(len([e for e in work if len(e.get("text", "")) > 80])),
        "highlight": [e["ref"] for e in work[:2]],
    }
