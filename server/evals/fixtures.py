"""Record/replay/resume for live eval runs (S5 gap 7).

One case-id-keyed JSON cache serves all three, because they are the
same mechanism viewed from three angles:
  - record: run live with --cache PATH; every case's raw model answer
    is written to PATH as it completes.
  - replay: rerun entirely offline from a previously recorded PATH,
    with --cache PATH --replay — no API key, no network, no spend. A
    case missing from the cache is a hard error, never a silent live
    fallback or a silent skip.
  - resume: rerun a live pass that was interrupted with --cache PATH
    (no --replay) — a case already in the cache is reused instead of
    re-calling (and re-charging) the model; anything missing is called
    live and added to the cache, so the pass can be interrupted and
    resumed any number of times without ever paying for a case twice.

CURRENT_CASE_ID is a contextvar rather than a model parameter because
harness.interpret()'s model signature (`model(payload) -> dict`) is
shared with the offline fake path and every live-model caller already
in __main__.py — adding a cache lookup inside that signature would mean
changing it for every caller. run_suite sets this var once per case
before calling the model; CachedModel reads it without touching that
signature at all.
"""

from __future__ import annotations

import json
from contextvars import ContextVar
from pathlib import Path
from typing import Callable

CURRENT_CASE_ID: ContextVar[str | None] = ContextVar("CURRENT_CASE_ID", default=None)
# Set once per attempt by the --repeats loop in __main__.py (None outside it).
# Folded into the cache key below so each repeat is an independent live call
# instead of replaying attempt 1's cached answer for every later attempt —
# without this, --repeats + --cache together only ever made ONE real call
# per case, defeating the flakiness check --repeats exists for.
CURRENT_REPEAT: ContextVar[int | None] = ContextVar("CURRENT_REPEAT", default=None)


class ReplayMiss(RuntimeError):
    """A --replay run hit a case with no recorded fixture."""


class CachedModel:
    def __init__(self, path: Path, *, live_model: Callable[[dict], dict] | None, strict: bool):
        self.path = path
        self.live_model = live_model
        self.strict = strict
        self.cache: dict[str, dict] = json.loads(path.read_text()) if path.exists() else {}
        self.hits = 0
        self.misses = 0

    def __call__(self, payload: dict) -> dict:
        case_id = CURRENT_CASE_ID.get()
        if case_id is None:
            raise RuntimeError("CachedModel called with no CURRENT_CASE_ID set — run_suite must set it per case")
        repeat = CURRENT_REPEAT.get()
        key = case_id if repeat is None else f"{case_id}#r{repeat}"
        if key in self.cache:
            self.hits += 1
            return self.cache[key]
        if self.strict or self.live_model is None:
            raise ReplayMiss(f"{key}: no recorded fixture in {self.path} and replay is strict (no live fallback)")
        self.misses += 1
        result = self.live_model(payload)
        self.cache[key] = result
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.cache, indent=2, sort_keys=True))
        return result
