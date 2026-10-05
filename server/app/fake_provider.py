"""A deterministic stand-in for OpenAI, for local runs and E2E only.

AI-plan §14: everything is built and tested against a fake provider
first. This one is selected with OPENAI_PROVIDER=fake and refuses to
start unless the database it would write to is on this machine, so the
fake path cannot exist against production (programme E3).

It answers each schema the code requests with plausible, deterministic
output derived from the input text, and embeds text by hashing its words
into a fixed-size unit vector, so retrieval over fake embeddings still
prefers documents that share words with the query.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlparse

from psycopg.conninfo import conninfo_to_dict

DIMENSIONS = 1536
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "host.docker.internal", "db", "supabase_db"}


class FakeProviderRefused(RuntimeError):
    pass


def assert_local(dsn: str | None) -> None:
    """The fake provider only ever runs against a local database."""
    if not dsn:
        raise FakeProviderRefused("OPENAI_PROVIDER=fake needs a database URL to check")
    try:
        host = conninfo_to_dict(dsn).get("host") or ""
    except Exception:  # noqa: BLE001 — an unparseable DSN is not provably local
        host = urlparse(dsn).hostname or ""
    if host not in _LOCAL_HOSTS:
        raise FakeProviderRefused(f"OPENAI_PROVIDER=fake refused: database host {host!r} is not local")


def enabled() -> bool:
    return os.environ.get("OPENAI_PROVIDER", "").lower() == "fake"


_WORD = re.compile(r"[a-z0-9+#.]+")


def embed(text: str) -> list[float]:
    vec = [0.0] * DIMENSIONS
    words = _WORD.findall((text or "").lower())
    for word in words:
        word = word.strip(".")
        if len(word) < 2:
            continue
        digest = hashlib.sha256(word.encode()).digest()
        index = int.from_bytes(digest[:4], "big") % DIMENSIONS
        vec[index] += 1.0 if digest[4] % 2 == 0 else -1.0
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0:
        vec[0] = 1.0
        return vec
    return [x / norm for x in vec]


_FAKE_SKILLS = [
    "Python", "PyTorch", "TensorFlow", "Keras", "scikit-learn", "FastAPI", "Django", "Flask", "React", "Next.js",
    "TypeScript", "JavaScript", "Node.js", "PostgreSQL", "Docker", "Kubernetes", "AWS", "Azure", "SQL", "Java",
    "C++", "Rust", "Go", "Figma", "Excel", "MATLAB", "pandas", "NumPy", "LangChain", "RAG", "Terraform", "Git",
]


def _mentions(text: str, term: str) -> bool:
    return re.search(rf"(?<![a-z0-9+#]){re.escape(term.lower())}(?![a-z0-9+#])", text.lower()) is not None


def _user_content(messages: list[dict] | None, inputs: Any = None) -> str:
    if messages:
        return "\n".join(str(m.get("content", "")) for m in messages if m.get("role") == "user")
    if isinstance(inputs, str):
        return inputs
    if isinstance(inputs, list):
        return "\n".join(str(m.get("content", "")) for m in inputs if isinstance(m, dict) and m.get("role") == "user")
    return ""


def _json_block(text: str, tag: str) -> Any:
    match = re.search(rf"<{tag}>\s*(.*?)\s*</{tag}>", text, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return match.group(1)


def answer(schema_name: str, user: str) -> dict:
    """The fake model's answer for one structured-output request."""
    if schema_name == "cv_profile":
        body = _json_block(user, "cv_content") or user
        body = body if isinstance(body, str) else json.dumps(body)
        skills = [s for s in _FAKE_SKILLS if _mentions(body, s)]
        return {
            "education": [],
            "roles": [],
            "projects": [],
            "skills_raw": skills,
            "languages": [],
            "links": [],
            "summary": (" ".join(body.split())[:400] or "No details."),
        }
    if schema_name == "repo_exclusions":
        return {"excluded": []}
    if schema_name == "repo_shortlist":
        repos = _json_block(user, "candidate_repos") or []
        return {"shortlist": [r.get("name") for r in repos[:8] if isinstance(r, dict)]}
    if schema_name == "repo_selection":
        repos = _json_block(user, "candidate_repos") or []
        return {"selected": [r.get("name") for r in repos[:3] if isinstance(r, dict)], "themes": []}
    if schema_name == "combined_summary":
        return {"summary": "A member with CV and GitHub evidence."}
    if schema_name == "job_requirements":
        payload = _json_block(user, "job") or {}
        text = payload.get("description", "") if isinstance(payload, dict) else str(payload)
        candidates = payload.get("candidate_concepts", []) if isinstance(payload, dict) else []
        atoms = []
        for slug in candidates[:10]:
            idx = text.lower().find(str(slug).replace("-", " "))
            window = text.lower()[max(0, idx - 60): idx + 10] if idx >= 0 else ""
            required = bool(re.search(r"\b(must|required|essential|need)\b", window))
            atoms.append({"concept": slug, "free_text": None, "required": required})
        level = "internship" if re.search(r"\bintern(ship)?\b", text, re.I) else "unspecified"
        return {"atoms": atoms, "role_level": level}
    raise ValueError(f"fake provider has no answer for schema {schema_name!r}")


def _usage(prompt: str, completion: str) -> SimpleNamespace:
    p = max(1, len(prompt) // 4)
    c = max(1, len(completion) // 4)
    return SimpleNamespace(prompt_tokens=p, completion_tokens=c, input_tokens=p, output_tokens=c, total_tokens=p + c)


class _ChatCompletions:
    def create(self, *, messages: list[dict], response_format: dict | None = None, **_kwargs: Any) -> Any:
        name = ((response_format or {}).get("json_schema") or {}).get("name", "")
        user = _user_content(messages)
        content = json.dumps(answer(name, user))
        message = SimpleNamespace(content=content, refusal=None)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message, finish_reason="stop")], usage=_usage(user, content)
        )


class _Embeddings:
    def create(self, *, input: Any, **_kwargs: Any) -> Any:
        texts = input if isinstance(input, list) else [input]
        data = [SimpleNamespace(embedding=embed(t)) for t in texts]
        return SimpleNamespace(data=data, usage=_usage(" ".join(texts), ""))


class _Moderations:
    def create(self, *, input: Any, **_kwargs: Any) -> Any:
        categories = SimpleNamespace(model_dump=lambda: {})
        return SimpleNamespace(results=[SimpleNamespace(flagged=False, categories=categories)])


class FakeOpenAI:
    def __init__(self) -> None:
        self.chat = SimpleNamespace(completions=_ChatCompletions())
        self.embeddings = _Embeddings()
        self.moderations = _Moderations()
