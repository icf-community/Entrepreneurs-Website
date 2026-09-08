"""Tests for ingest pipeline steps 4-6 (server/app/cv_pipeline.py).

Mocks the OpenAI client throughout — same approach as test_moderation.py
and test_cv_sanitise.py's get_blob mock — so these run with no API key
and no database.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.cv_pipeline import (
    EMBEDDING_MODEL,
    EXTRACTION_MODEL,
    ExtractionError,
    chunk_and_embed,
    extract_profile,
    normalise_skills,
    vector_literal,
)

VALID_PROFILE = {
    "education": [
        {
            "institution": "Imperial College London",
            "course": "Computing",
            "level": "bachelors",
            "start_year": 2021,
            "expected_completion_year": 2025,
            "grade": None,
        }
    ],
    "roles": [
        {
            "organisation": "Acme Corp",
            "title": "Backend Intern",
            "start_date": "2024-06",
            "end_date": "2024-09",
            "description": "Built internal tooling in Python.",
            "is_current": False,
        }
    ],
    "projects": [
        {
            "name": "Foundry",
            "description": "A community platform for student entrepreneurs.",
            "role": "Lead developer",
            "technologies": ["Python", "TypeScript"],
        }
    ],
    "skills_raw": ["Python", "TypeScript", "Project management"],
    "languages": [{"language": "English", "proficiency": "native"}],
    "links": [{"type": "github", "url": "https://github.com/example"}],
    "summary": "A software engineer with backend and product experience.",
}


def _fake_chat_response(content: str | None) -> SimpleNamespace:
    message = SimpleNamespace(content=content)
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


# ─── extract_profile ──────────────────────────────────────────────────


def test_extract_profile_returns_the_model_profile_and_summary() -> None:
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps(VALID_PROFILE))
    with patch("app.cv_pipeline.client", return_value=fake_client):
        result = extract_profile("Jane Doe's CV text")
    assert result.profile == VALID_PROFILE
    assert result.summary == VALID_PROFILE["summary"]
    assert result.model_name == EXTRACTION_MODEL


def test_extract_profile_wraps_cv_text_in_delimiters() -> None:
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps(VALID_PROFILE))
    with patch("app.cv_pipeline.client", return_value=fake_client):
        extract_profile("some raw cv text")
    _, kwargs = fake_client.chat.completions.create.call_args
    user_message = next(m["content"] for m in kwargs["messages"] if m["role"] == "user")
    assert "<cv_content>" in user_message
    assert "some raw cv text" in user_message
    assert "</cv_content>" in user_message


def test_extract_profile_uses_strict_structured_outputs() -> None:
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps(VALID_PROFILE))
    with patch("app.cv_pipeline.client", return_value=fake_client):
        extract_profile("cv text")
    _, kwargs = fake_client.chat.completions.create.call_args
    assert kwargs["response_format"]["type"] == "json_schema"
    assert kwargs["response_format"]["json_schema"]["strict"] is True


def test_extract_profile_raises_on_invalid_json() -> None:
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response("not json")
    with patch("app.cv_pipeline.client", return_value=fake_client), pytest.raises(ExtractionError):
        extract_profile("cv text")


def test_extract_profile_raises_on_missing_required_field() -> None:
    incomplete = dict(VALID_PROFILE)
    del incomplete["summary"]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps(incomplete))
    with patch("app.cv_pipeline.client", return_value=fake_client), pytest.raises(ExtractionError):
        extract_profile("cv text")


# ─── normalise_skills ─────────────────────────────────────────────────


def _fake_embeddings_response(vectors: list[list[float]]) -> SimpleNamespace:
    return SimpleNamespace(data=[SimpleNamespace(embedding=v) for v in vectors])


def test_normalise_skills_matches_above_threshold() -> None:
    fake_client = MagicMock()
    fake_client.embeddings.create.return_value = _fake_embeddings_response([[0.1, 0.2]])

    fake_cursor = MagicMock()
    fake_cursor.fetchone.return_value = ("skill-uuid", "Python", 0.95)
    fake_cursor.__enter__.return_value = fake_cursor
    fake_conn = MagicMock()
    fake_conn.cursor.return_value = fake_cursor

    with patch("app.cv_pipeline.client", return_value=fake_client):
        matches = normalise_skills(["python"], fake_conn)

    assert len(matches) == 1
    assert matches[0].skill_id == "skill-uuid"
    assert matches[0].canonical_name == "Python"
    assert matches[0].confidence == 0.95


def test_normalise_skills_leaves_low_confidence_unmatched() -> None:
    fake_client = MagicMock()
    fake_client.embeddings.create.return_value = _fake_embeddings_response([[0.1, 0.2]])

    fake_cursor = MagicMock()
    fake_cursor.fetchone.return_value = ("skill-uuid", "Underwater basket weaving", 0.4)
    fake_cursor.__enter__.return_value = fake_cursor
    fake_conn = MagicMock()
    fake_conn.cursor.return_value = fake_cursor

    with patch("app.cv_pipeline.client", return_value=fake_client):
        matches = normalise_skills(["some obscure skill"], fake_conn)

    assert matches[0].skill_id is None
    assert matches[0].canonical_name is None


def test_normalise_skills_empty_input_makes_no_calls() -> None:
    fake_client = MagicMock()
    with patch("app.cv_pipeline.client", return_value=fake_client):
        assert normalise_skills([], MagicMock()) == []
    fake_client.embeddings.create.assert_not_called()


# ─── chunk_and_embed ──────────────────────────────────────────────────


def test_chunk_and_embed_produces_one_chunk_per_role_project_plus_three() -> None:
    fake_client = MagicMock()
    # roles(1) + projects(1) + education(1) + skills(1) + summary(1) = 5
    fake_client.embeddings.create.return_value = _fake_embeddings_response([[0.0]] * 5)
    with patch("app.cv_pipeline.client", return_value=fake_client):
        chunks = chunk_and_embed(VALID_PROFILE)

    types = [c.chunk_type for c in chunks]
    assert types == ["role", "project", "education", "skills", "summary"]
    assert all(c.embedding_model == EMBEDDING_MODEL for c in chunks)


def test_role_chunk_is_self_contained() -> None:
    fake_client = MagicMock()
    fake_client.embeddings.create.return_value = _fake_embeddings_response([[0.0]] * 5)
    with patch("app.cv_pipeline.client", return_value=fake_client):
        chunks = chunk_and_embed(VALID_PROFILE)

    role_chunk = next(c for c in chunks if c.chunk_type == "role")
    assert "Backend Intern" in role_chunk.content
    assert "Acme Corp" in role_chunk.content
    assert "Built internal tooling in Python." in role_chunk.content


def test_embedding_calls_are_batched_once() -> None:
    fake_client = MagicMock()
    fake_client.embeddings.create.return_value = _fake_embeddings_response([[0.0]] * 5)
    with patch("app.cv_pipeline.client", return_value=fake_client):
        chunk_and_embed(VALID_PROFILE)
    fake_client.embeddings.create.assert_called_once()


# ─── vector_literal ───────────────────────────────────────────────────


def test_vector_literal_formats_as_pgvector_input() -> None:
    assert vector_literal([1.0, 2.5, -0.3]) == "[1.0,2.5,-0.3]"
