"""Full nested validation of model responses (AI-plan §3 step 4).

Structured Outputs makes a schema-shaped response the contract, not a
guarantee: refusals, truncation and the occasional malformed object still
happen. Every response is checked against the same JSON Schema it was
requested with, at every level, plus local bounds the provider schema
does not carry (string length, array length, finite numbers). Anything
that fails is a failed call, never a partially trusted one.

Supports the subset our schemas use: type (including ["string", "null"]),
enum, required, properties, additionalProperties: false, items, minimum,
maximum.
"""

from __future__ import annotations

import math


class SchemaError(ValueError):
    pass


_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "null": type(None),
}


def _is_type(value: object, name: str) -> bool:
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    expected = _TYPES.get(name)
    return expected is not None and isinstance(value, expected) and not (name != "boolean" and isinstance(value, bool))


def validate(instance: object, schema: dict, *, max_string: int = 4000, max_items: int = 200) -> None:
    errors: list[str] = []
    _check(instance, schema, "$", errors, max_string, max_items)
    if errors:
        raise SchemaError("; ".join(errors[:5]))


def _check(value: object, schema: dict, path: str, errors: list[str], max_string: int, max_items: int) -> None:
    types = schema.get("type")
    if types is not None:
        names = types if isinstance(types, list) else [types]
        if not any(_is_type(value, name) for name in names):
            errors.append(f"{path}: expected {'/'.join(names)}")
            return
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: not an allowed value")
        return
    if isinstance(value, float) and not math.isfinite(value):
        errors.append(f"{path}: not finite")
        return
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: above maximum")
    if isinstance(value, str) and len(value) > schema.get("maxLength", max_string):
        errors.append(f"{path}: too long")
    if isinstance(value, list):
        if len(value) > schema.get("maxItems", max_items):
            errors.append(f"{path}: too many items")
            return
        item_schema = schema.get("items")
        if item_schema:
            for i, item in enumerate(value):
                _check(item, item_schema, f"{path}[{i}]", errors, max_string, max_items)
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}.{key}: missing")
        if schema.get("additionalProperties") is False:
            extra = set(value) - set(props)
            if extra:
                errors.append(f"{path}: unexpected {sorted(extra)[:3]}")
        for key, sub in props.items():
            if key in value:
                _check(value[key], sub, f"{path}.{key}", errors, max_string, max_items)
