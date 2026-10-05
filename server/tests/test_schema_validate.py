"""Nested response validation (app/schema_validate.py, AI-plan §3 step 4)."""

from __future__ import annotations

import math

import pytest

from app.schema_validate import SchemaError, validate

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items", "level"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "year"],
                "properties": {"name": {"type": "string"}, "year": {"type": ["integer", "null"]}},
            },
        },
        "level": {"type": "string", "enum": ["a", "b"]},
        "score": {"type": "number", "minimum": 0, "maximum": 1},
    },
}


def test_accepts_a_valid_nested_object() -> None:
    validate({"items": [{"name": "x", "year": None}, {"name": "y", "year": 2024}], "level": "a"}, SCHEMA)


@pytest.mark.parametrize(
    "value",
    [
        {"items": [{"name": "x"}], "level": "a"},  # nested required
        {"items": [{"name": "x", "year": "2024"}], "level": "a"},  # nested type
        {"items": [{"name": "x", "year": 1, "extra": 1}], "level": "a"},  # nested additionalProperties
        {"items": [], "level": "c"},  # enum
        {"items": [], "level": "a", "score": 2},  # maximum
        {"items": [], "level": "a", "score": math.inf},  # finite
        {"items": [{"name": "x" * 5000, "year": 1}], "level": "a"},  # length bound
        {"items": [{"name": "x", "year": True}], "level": "a"},  # bool is not an integer
        {"items": "nope", "level": "a"},
    ],
)
def test_rejects_anything_off_schema_at_any_depth(value: dict) -> None:
    with pytest.raises(SchemaError):
        validate(value, SCHEMA)


def test_bounds_array_length() -> None:
    with pytest.raises(SchemaError):
        validate({"items": [{"name": "x", "year": 1}] * 3, "level": "a"}, SCHEMA, max_items=2)
