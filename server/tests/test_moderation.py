"""Tests for the CV moderation step (3b) — mocks the OpenAI client the
same way test_cv_sanitise.py mocks get_blob, so no real API key or
network access is needed to run these."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.moderation import MODERATION_MODEL, moderate_cv


def _fake_response(*, flagged: bool, categories: dict[str, bool]) -> SimpleNamespace:
    result = SimpleNamespace(flagged=flagged, categories=SimpleNamespace(model_dump=lambda: categories))
    return SimpleNamespace(results=[result])


def test_clean_text_is_not_flagged() -> None:
    fake_client = MagicMock()
    fake_client.moderations.create.return_value = _fake_response(
        flagged=False, categories={"harassment": False, "violence": False}
    )
    with patch("app.moderation.client", return_value=fake_client):
        result = moderate_cv("Software engineer with five years of backend experience.")
    assert not result.flagged
    assert result.categories == []


def test_flagged_text_reports_categories() -> None:
    fake_client = MagicMock()
    fake_client.moderations.create.return_value = _fake_response(
        flagged=True, categories={"harassment": True, "violence": False, "hate": True}
    )
    with patch("app.moderation.client", return_value=fake_client):
        result = moderate_cv("some text")
    assert result.flagged
    assert set(result.categories) == {"harassment", "hate"}


def test_uses_the_documented_moderation_model() -> None:
    fake_client = MagicMock()
    fake_client.moderations.create.return_value = _fake_response(flagged=False, categories={})
    with patch("app.moderation.client", return_value=fake_client):
        moderate_cv("some text")
    fake_client.moderations.create.assert_called_once_with(model=MODERATION_MODEL, input="some text")
