"""The executor's main loop: N concurrent workers, each claiming one turn
at a time from Postgres (AI-plan §9, §10.1).

The shared ceiling on active turns lives in the database (exec_claim
refuses to claim past it), so any number of replicas share one limit.
SIGTERM stops new claims and lets running turns finish; a replica that
dies mid-turn leaves a lease that expires, and the reaper fails that turn
rather than re-running a call that may already have been billed.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
import time

import psycopg

from .. import observability
from ..concepts import Dictionary
from .config import ai_settings
from .db import Db
from .pipeline import run_turn
from .provider import FakeProvider, OpenAIProvider

log = logging.getLogger("foundry.ai")
HEARTBEAT_MINUTES = 5
DICTIONARY_TTL_SECONDS = 3600


class _DictionaryCache:
    def __init__(self) -> None:
        self._value: Dictionary | None = None
        self._loaded = 0.0
        self._lock = asyncio.Lock()

    async def get(self, db: Db) -> Dictionary:
        async with self._lock:
            if self._value is None or time.monotonic() - self._loaded > DICTIONARY_TTL_SECONDS:
                concepts = await db.rows("select slug, label, kind, aliases, ambiguous, dictionary_version "
                                         "from ai_private.worker_concepts()")
                relations = await db.rows("select from_slug, to_slug, relation, weight "
                                          "from ai_private.worker_concept_relations()")
                self._value = Dictionary.from_rows(
                    [(c["slug"], c["label"], c["kind"], c["aliases"], c["ambiguous"]) for c in concepts],
                    [(r["from_slug"], r["to_slug"], r["relation"], r["weight"]) for r in relations],
                    version=max((c["dictionary_version"] for c in concepts), default=1),
                )
                self._loaded = time.monotonic()
            return self._value


async def preflight(db: Db, settings) -> None:
    """Refuse paid mode without confirmed prices for every configured model
    (§9.1: startup must refuse with missing prices or enforcement)."""
    models = [settings.interpreter_model, settings.embedding_model, *settings.assessor_models.values()]
    missing = await db.one("select ai_private.exec_preflight(%s)", (models,))
    if missing:
        raise SystemExit(f"AI executor refused to start: no confirmed price for {', '.join(missing)}")


async def _worker(index: int, settings, provider, dictionary: _DictionaryCache, stopping: asyncio.Event) -> None:
    name = f"{socket.gethostname()}:{os.getpid()}:{index}"
    db = Db(settings.database_url)
    failures = 0
    try:
        while not stopping.is_set():
            try:
                ctx = await db.one("select ai_private.exec_claim(%s)", (name,))
                failures = 0
            except psycopg.Error as exc:
                failures += 1
                if failures == 1 or failures % 60 == 0:
                    observability.capture(exc)
                log.warning("claim failed (%s consecutive)", failures)
                await asyncio.sleep(min(2 ** min(failures, 6), 60))
                continue
            if ctx is None:
                await asyncio.sleep(settings.poll_seconds)
                continue
            await run_turn(db, provider, settings, await dictionary.get(db), ctx)
    finally:
        await db.close()


async def main_async() -> None:
    settings = ai_settings()
    observability.init_sentry("ai-executor")
    provider = FakeProvider() if settings.provider == "fake" else OpenAIProvider(settings.openai_api_key)
    db = Db(settings.database_url)
    try:
        await preflight(db, settings)
    finally:
        await db.close()

    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopping.set)

    dictionary = _DictionaryCache()

    async def heartbeat() -> None:
        while not stopping.is_set():
            observability.heartbeat("ai-executor", HEARTBEAT_MINUTES)
            try:
                await asyncio.wait_for(stopping.wait(), HEARTBEAT_MINUTES * 60)
            except asyncio.TimeoutError:
                pass

    log.info("AI executor starting: %s workers, provider=%s", settings.workers, settings.provider)
    await asyncio.gather(heartbeat(), *(_worker(i, settings, provider, dictionary, stopping)
                                        for i in range(settings.workers)))
    log.info("AI executor stopped cleanly")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main_async())
