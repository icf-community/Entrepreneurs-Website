"""The fully consumed criteria grammar (app/ai/grammar.py, AI-plan §4)."""

from __future__ import annotations

from app.ai.grammar import parse
from tests.test_concepts import D


def test_known_terms_become_operations_without_a_model() -> None:
    ops = parse("PyTorch and Python", "recruiter", D)
    assert [(o["concept"], o["required"]) for o in ops] == [("pytorch", False), ("python", False)]


def test_required_preferred_and_negation() -> None:
    ops = parse("must have PyTorch, nice to have Python, not TensorFlow", "recruiter", D)
    assert [(o["concept"], o["required"], o["negated"]) for o in ops] == [
        ("pytorch", True, False), ("python", False, False), ("tensorflow", True, True)]


def test_or_makes_a_group() -> None:
    ops = parse("PyTorch or TensorFlow", "recruiter", D)
    assert ops[0]["group"] == ops[1]["group"] == "g1"


def test_any_unknown_word_hands_over_to_the_interpreter() -> None:
    assert parse("PyTorch people who teach Pythagoras", "recruiter", D) is None
    assert parse("explain PyTorch", "recruiter", D) is None


def test_interests_only_where_the_mode_allows_them() -> None:
    assert parse("must also like chess", "network", D)[0] == {
        "op": "add", "kind": "interest", "concept": "chess", "required": True, "negated": False, "group": None}
    assert parse("chess", "recruiter", D) is None
