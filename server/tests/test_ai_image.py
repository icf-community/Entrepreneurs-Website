"""The slim AI image (Dockerfile.ai) installs only requirements-ai.txt, so
the executor must never import the worker's storage, CV, GitHub or image
code (AI-plan §4, §10). This walks the import graph from app.ai and fails
on any module outside the allowed set, and checks every third-party import
it reaches is pinned in requirements-ai.txt."""

from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
FORBIDDEN = {"app.worker", "app.storage", "app.cv_pipeline", "app.github_pipeline", "app.documents", "app.images",
             "app.main", "app.cv_sanitise", "app.moderation", "app.auth", "app.projection", "app.ledger",
             "app.openai_client"}
THIRD_PARTY_OK = {"openai", "psycopg", "sentry_sdk"}


def _imports(module: str) -> tuple[set[str], set[str]]:
    rel = module.removeprefix("app").lstrip(".").replace(".", "/")
    path = APP / (rel + ".py") if (APP / (rel + ".py")).exists() else APP / rel / "__init__.py"
    tree = ast.parse(path.read_text())
    internal, external = set(), set()
    package = module if path.name == "__init__.py" else module.rsplit(".", 1)[0]
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level:
                base = package.split(".")
                base = base[: len(base) - (node.level - 1)]
                target = ".".join(base + ([node.module] if node.module else []))
                if node.module is None:
                    internal.update(f"{target}.{a.name}" for a in node.names)
                else:
                    internal.add(target)
            elif node.module and node.module.startswith("app"):
                internal.add(node.module)
            elif node.module:
                external.add(node.module.split(".")[0])
        elif isinstance(node, ast.Import):
            for a in node.names:
                (internal if a.name.startswith("app") else external).add(a.name.split(".")[0] if not a.name.startswith("app") else a.name)
    return internal, external


def test_executor_imports_nothing_from_the_worker_side() -> None:
    seen, stack, external = set(), ["app.ai.runner", "app.ai.pipeline", "app.ai.provider"], set()
    while stack:
        mod = stack.pop()
        if mod in seen:
            continue
        seen.add(mod)
        rel = mod.removeprefix("app").lstrip(".").replace(".", "/")
        if not ((APP / (rel + ".py")).exists() or (APP / rel / "__init__.py").exists()):
            continue  # an attribute imported from a package, not a module
        internal, ext = _imports(mod)
        external |= ext
        stack.extend(internal)
    assert not (seen & FORBIDDEN), f"the AI executor reaches {sorted(seen & FORBIDDEN)}"
    import sys
    stdlib = set(sys.stdlib_module_names) | {"__future__"}
    assert external - stdlib <= THIRD_PARTY_OK, sorted(external - stdlib - THIRD_PARTY_OK)


def test_requirements_ai_is_a_pinned_subset() -> None:
    full = dict(l.strip().split("==") for l in (APP.parent / "requirements.txt").read_text().splitlines()
                if "==" in l and not l.startswith("#"))
    slim = dict(l.strip().split("==") for l in (APP.parent / "requirements-ai.txt").read_text().splitlines()
                if "==" in l and not l.startswith("#"))
    assert {k: v for k, v in slim.items() if full.get(k) != v} == {}
    assert {"openai", "psycopg", "sentry-sdk"} <= set(slim)
