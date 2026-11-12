"""S4 gap 15: outage drills — the executor and its ledger must survive a
database hiccup and a provider that is down, without losing a turn,
duplicating a provider call, or retry-storming the provider.

No Docker restart is driven here: psycopg's `Db` class already detects a
closed connection and reconnects on the next call (db.py's
`except psycopg.OperationalError: await self.close(); raise` plus the
lazy reconnect in `_connection()`), so forcibly closing the live
connection object exercises exactly the code path a real restart would
hit, deterministically and without disrupting the shared local stack
this whole session has been running against.

Opt-in like the other AI integration tests (AI_INTEGRATION_DSN, local only).
"""

from __future__ import annotations

import asyncio
import os

import psycopg
import pytest

from .test_ai_races import _clear_queue, _submit, ai  # noqa: F401 — fixture

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")


async def _run_claimed_turn(fault, *, kill_connection_after_claim=False):
    from app.ai import config as ai_config
    from app.ai.db import Db
    from app.ai.pipeline import run_turn
    from app.ai.provider import FakeProvider
    from app.ai.runner import _DictionaryCache

    params = psycopg.conninfo.conninfo_to_dict(DSN)
    params.setdefault("sslmode", "disable")
    os.environ["AI_DATABASE_URL"] = psycopg.conninfo.make_conninfo(**params)
    os.environ["AI_PROVIDER"] = "fake"
    ai_config.ai_settings.cache_clear()
    settings = ai_config.ai_settings()
    db = Db(settings.database_url)
    provider = FakeProvider(fault=fault)
    try:
        ctx = await db.one("select ai_private.exec_claim(%s)", ("outage-test",))
        assert ctx, "nothing to claim"
        if kill_connection_after_claim:
            conn = await db._connection()  # noqa: SLF001 — deliberately simulating a dropped connection
            await conn.close()
        await run_turn(db, provider, settings, await _DictionaryCache().get(db), ctx)
    finally:
        await db.close()
    return provider


def _setup_pair(ai, tag: str):
    """A candidate for retrieval to find, plus an owner whose message
    forces real model interpretation (see test_ai_faults.py's docstring:
    a plain concept word is grammar-matched and never reaches the model)."""
    ai.candidate(tag + "target")
    owner = ai.member(tag + "owner")
    turn, conversation, outcome = _submit(ai, owner, "python ninja")
    assert outcome == "queued", outcome
    return turn


def _turn_row(ai, turn):
    return ai.execute("select status, outcome, lease_token from ai_private.turns where id = %s", (turn,)).fetchone()


# ─── a DB restart mid-turn ──────────────────────────────────────────────

def test_a_dropped_connection_right_after_claim_still_finishes_the_turn(ai):
    """The DB connection dies the instant the lease is acquired —
    everything the turn does from here on must happen over a fresh
    connection, and the provider must be called exactly once (no
    duplicate call caused by the reconnect)."""
    turn = _setup_pair(ai, "outagereconnect")
    provider = asyncio.run(_run_claimed_turn(None, kill_connection_after_claim=True))
    status, outcome, lease = _turn_row(ai, turn)
    assert status in ("completed", "partial"), (status, outcome)
    assert lease is None
    # A normal successful turn makes at most 3 calls here (memory
    # embedding + interpret + a retrieval query embedding, none
    # retried since nothing failed) — the DB hiccup happened before any
    # of them, so this just confirms it still ran once through cleanly,
    # not duplicated by the reconnect.
    assert 1 <= provider.calls <= 3, f"unexpected provider call count after reconnect: {provider.calls}"


def test_db_client_reconnects_after_its_connection_is_closed_underneath_it():
    """Unit-level: Db itself, independent of any turn, reconnects after
    the connection it was holding is closed — the exact mechanism the
    turn-level test above relies on."""
    from app.ai import config as ai_config
    from app.ai.db import Db

    params = psycopg.conninfo.conninfo_to_dict(DSN)
    params.setdefault("sslmode", "disable")
    os.environ["AI_DATABASE_URL"] = psycopg.conninfo.make_conninfo(**params)
    os.environ["AI_PROVIDER"] = "fake"
    ai_config.ai_settings.cache_clear()
    settings = ai_config.ai_settings()

    async def go():
        db = Db(settings.database_url)
        try:
            assert await db.one("select 1") == 1
            conn = await db._connection()  # noqa: SLF001
            await conn.close()
            assert await db.one("select 1") == 1
        finally:
            await db.close()

    asyncio.run(go())


# ─── a provider 5xx/429 storm ───────────────────────────────────────────

def test_a_provider_error_storm_never_retries_more_than_once_per_turn(ai):
    """Three turns in a row against a provider that always fails: each
    one gets exactly its one explicit retry on the stage that uses it
    (pipeline.with_retry on interpret), never an unbounded retry storm,
    and each still ends in a clean terminal state with no reservation
    left open. Confirmed by trace_spans: a failing turn makes at most
    3 calls — one memory-embedding attempt (caught, falls back to
    keyword memory, never retried) plus interpret's own one retry — and
    never reaches retrieval, since interpret's failure ends the turn."""
    for i in range(3):
        turn = _setup_pair(ai, f"outagestorm{i}")
        provider = asyncio.run(_run_claimed_turn("server_error"))
        assert provider.calls <= 3, f"turn {i}: {provider.calls} provider calls, expected at most 3"
        status, outcome, lease = _turn_row(ai, turn)
        assert status == "failed", (status, outcome)
        assert lease is None
        reserved = ai.execute("select count(*) from ai_private.spend where turn_id = %s and status = 'reserved'",
                             (turn,)).fetchone()[0]
        assert reserved == 0, f"turn {i}: {reserved} reservations left open after the storm"


# ─── recovery goes through the normal queue, no backlog flush ─────────

def test_recovery_after_a_storm_is_ordinary_admission_not_a_flush(ai):
    """After a run of failures, a fresh submission is admitted (or
    refused) by the same queue_capacity check as any other day — there
    is no special "drain the backlog" code path to regress."""
    _clear_queue(ai)
    saved = ai.execute("select queue_capacity from ai_private.settings where id = 1").fetchone()[0]
    try:
        # Fail three turns first (the "storm").
        for i in range(3):
            turn = _setup_pair(ai, f"outagerecover{i}")
            asyncio.run(_run_claimed_turn("server_error"))
        # Normal admission afterwards still respects the ordinary cap —
        # queued (0 already queued, N-1 of 1) admits exactly as before.
        ai.execute("update ai_private.settings set queue_capacity = 1 where id = 1")
        owner = ai.member("outagerecoverfresh")
        first = _submit(ai, owner, "python")
        assert first[2] == "queued", first
        second = _submit(ai, owner, "rust", conversation=None)
        assert second[2] == "queue_full", second  # same admission rules, nothing special post-storm
    finally:
        ai.execute("update ai_private.settings set queue_capacity = %s where id = 1", (saved,))
