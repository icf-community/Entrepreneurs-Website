"""Structured-output schemas for the executor's two model calls, and the
prompt texts they are sent with. Prompts live in prompts/*.txt; every call
records the prompt's content hash (programme G9), so a trace or eval
result ties back to the exact text."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

_PROMPTS = Path(__file__).resolve().parent / "prompts"

KINDS = ["tool", "method", "area", "language", "interest", "free", "seek", "offer", "location", "role_type"]

INTERPRET_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["decision", "ops"],
    "properties": {
        "decision": {"type": "string", "enum": ["apply", "clarify", "off_task", "sensitive", "injection", "mixed"]},
        "ops": {
            "type": "array",
            "maxItems": 12,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["op", "kind", "concept", "free_text", "span_start", "span_end", "required", "negated",
                             "group", "atom"],
                "properties": {
                    "op": {"type": "string", "enum": ["add", "remove", "set_required", "clear"]},
                    "kind": {"type": ["string", "null"], "enum": KINDS + [None]},
                    "concept": {"type": ["string", "null"], "maxLength": 48},
                    "free_text": {"type": ["string", "null"], "maxLength": 80},
                    "span_start": {"type": ["integer", "null"], "minimum": 0, "maximum": 700},
                    "span_end": {"type": ["integer", "null"], "minimum": 0, "maximum": 700},
                    "required": {"type": ["boolean", "null"]},
                    "negated": {"type": ["boolean", "null"]},
                    "group": {"type": ["string", "null"], "enum": ["g1", "g2", "g3", "g4", None]},
                    "atom": {"type": ["string", "null"], "maxLength": 8},
                },
            },
        },
    },
}

_LEVEL = {"type": "string", "enum": ["none", "some", "strong"]}

ASSESS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["candidates"],
    "properties": {
        "candidates": {
            "type": "array",
            "maxItems": 5,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["ref", "atoms", "task", "depth", "highlight"],
                "properties": {
                    "ref": {"type": "string", "maxLength": 8},
                    "atoms": {
                        "type": "array",
                        "maxItems": 12,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["atom", "state", "evidence"],
                            "properties": {
                                "atom": {"type": "string", "maxLength": 8},
                                "state": {"type": "string", "enum": ["met", "not_evidenced", "unknown"]},
                                "evidence": {"type": "array", "maxItems": 4, "items": {"type": "string", "maxLength": 8}},
                            },
                        },
                    },
                    "task": _LEVEL,
                    "depth": _LEVEL,
                    "highlight": {"type": "array", "maxItems": 2, "items": {"type": "string", "maxLength": 8}},
                },
            },
        }
    },
}


@lru_cache(maxsize=None)
def prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.txt").read_text().strip()


@lru_cache(maxsize=None)
def prompt_hash(name: str) -> str:
    return hashlib.sha256(prompt(name).encode()).hexdigest()


INTERPRET_PROMPT_VERSION = "interpret-v3"
ASSESS_PROMPT_VERSION = "assess-v3"
RUBRIC_VERSION = "rubric-v1"
