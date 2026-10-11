"""Every provider call site, inventoried and metered (AI-plan §9.1, A0.1).

"Isolate production egress to approved wrappers and verify no unmetered
SDK/client escapes." This walks the source: each call into the OpenAI
SDK must sit inside a metered block (the ingestion ledger, or the AI
executor's reservation wrapper), and the list of call sites must match
INVENTORY below. Adding a call site fails this test until it is both
metered and listed here, which is the point.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"

# (file, enclosing function) → what it sends. Keep in step with
# docs/ai-egress-inventory.md.
INVENTORY = {
    ("cv_pipeline.py", "extract_profile"): "minimised CV text → structured profile",
    ("cv_pipeline.py", "_embed"): "skill strings, CV chunks, summaries, projection bodies → embeddings",
    ("moderation.py", "moderate_cv"): "minimised CV text → moderation",
    ("github_pipeline.py", "_create_chat_completion"): "minimised repo metadata/READMEs, summary inputs",
    ("projection.py", "parse_requirements"): "minimised job advert → requirement list",
    ("ai/provider.py", "OpenAIProvider._call"): "AI executor: interpretation, assessment, query and memory embeddings",
}

_SDK_ATTRS = {"completions", "embeddings", "moderations", "responses"}
_EXEMPT = {"fake_provider.py", "openai_client.py"}  # the fake itself, and the B2.8 load-test stub


def _call_sites() -> dict[tuple[str, str], ast.Call]:
    sites: dict[tuple[str, str], ast.Call] = {}
    for path in sorted(APP.rglob("*.py")):
        rel = str(path.relative_to(APP))
        if rel in _EXEMPT:
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for call in ast.walk(node):
                if (
                    isinstance(call, ast.Call)
                    and isinstance(call.func, ast.Attribute)
                    and call.func.attr == "create"
                    and isinstance(call.func.value, ast.Attribute)
                    and call.func.value.attr in _SDK_ATTRS
                ):
                    owner = _qualname(tree, node)
                    sites[(rel, owner)] = call
                    _assert_metered(path, node, call, rel, owner)
    return sites


def _qualname(tree: ast.Module, fn: ast.AST) -> str:
    for cls in ast.walk(tree):
        if isinstance(cls, ast.ClassDef) and fn in cls.body:
            return f"{cls.name}.{fn.name}"  # type: ignore[attr-defined]
    return fn.name  # type: ignore[attr-defined]


def _assert_metered(path: Path, fn: ast.AST, call: ast.Call, rel: str, owner: str) -> None:
    """The SDK call must be lexically inside a `with ...metered(...)` block
    (ingestion), or inside the executor's `_call`, which may only run with
    a reservation id passed in."""
    for node in ast.walk(fn):
        if isinstance(node, (ast.With, ast.AsyncWith)):
            uses_meter = any(
                isinstance(item.context_expr, ast.Call)
                and isinstance(item.context_expr.func, ast.Attribute)
                and item.context_expr.func.attr == "metered"
                for item in node.items
            )
            if uses_meter and any(child is call for child in ast.walk(node)):
                return
    if owner == "OpenAIProvider._call":
        args = [a.arg for a in fn.args.args]  # type: ignore[attr-defined]
        assert "reservation" in args, f"{rel}:{owner} must take a reservation"
        return
    raise AssertionError(f"{rel}:{owner} calls the provider outside a metered block")


def test_every_provider_call_is_metered_and_inventoried() -> None:
    sites = _call_sites()
    unlisted = set(sites) - set(INVENTORY)
    assert not unlisted, f"provider call sites missing from INVENTORY: {sorted(unlisted)}"


def test_inventory_has_no_stale_entries() -> None:
    sites = _call_sites()
    stale = {key for key in INVENTORY if key not in sites and (APP / key[0]).exists()}
    assert not stale, f"INVENTORY lists call sites that no longer exist: {sorted(stale)}"
