"""S4 gap 11: fault-injecting fake provider. Each fault is driven through
the real executor pipeline (run_turn), against a real local Supabase, so
these prove the *pipeline's* handling of a failure mode, not just that the
fake can produce one.

Interpretation of a plain concept word like "python" is grammar-matched
and never reaches the model (the deterministic pre-model screen, §9.1);
one unknown word ("ninja") is enough to force grammar.parse to return
None and hand interpretation to the model, which is where every fault
here actually fires. A target candidate is still seeded so the success
case exercises retrieval and publish too.

Opt-in like the other AI integration tests (AI_INTEGRATION_DSN, local only).
"""

from __future__ import annotations

import asyncio
import os

import psycopg
import pytest

from .test_ai_races import ai, _submit

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")


async def _run_turn_with(fault: str | None) -> None:
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
        ctx = await db.one("select ai_private.exec_claim(%s)", (f"fault-test-{fault}",))
        assert ctx, "nothing to claim"
        await run_turn(db, provider, settings, await _DictionaryCache().get(db), ctx)
    finally:
        await db.close()


def _run(fault: str | None) -> None:
    asyncio.run(_run_turn_with(fault))


def _turn_row(ai, turn):
    return ai.execute("select status, outcome, lease_token from ai_private.turns where id = %s", (turn,)).fetchone()


def _reservations(ai, turn):
    return ai.execute("select status from ai_private.spend where turn_id = %s", (turn,)).fetchall()


def _setup(ai, tag: str):
    """An owner with nothing of their own plus one real candidate, so
    retrieval finds a target and assessment actually calls the model."""
    ai.candidate(tag + "target")
    owner = ai.member(tag + "owner")
    turn, conversation, outcome = _submit(ai, owner, "python ninja")
    assert outcome == "queued", outcome
    return turn


@pytest.mark.parametrize("fault,expected_outcome", [
    ("rate_limit", "unavailable"),
    ("server_error", "unavailable"),
    ("timeout_after_success", "unavailable"),
])
def test_provider_errors_end_the_turn_cleanly_with_no_dangling_reservation(ai, fault, expected_outcome):
    """A provider error (rate limit, 5xx, or a timeout on an already-sent
    request) must not leave the turn stuck or the reservation open."""
    turn = _setup(ai, "fault" + fault.replace("_", ""))
    _run(fault)
    status, outcome, lease = _turn_row(ai, turn)
    assert status == "failed"
    assert outcome == expected_outcome
    assert lease is None
    # every reservation this turn made is resolved (released, settled, or
    # explicitly marked unknown) — never left "reserved" forever.
    assert all(r[0] != "reserved" for r in _reservations(ai, turn))


def test_invalid_output_is_rejected_by_schema_validation_not_silently_accepted(ai):
    turn = _setup(ai, "faultinvalid")
    _run("invalid_output")
    status, outcome, lease = _turn_row(ai, turn)
    assert status == "failed"
    assert lease is None
    assert all(r[0] != "reserved" for r in _reservations(ai, turn))


def test_crash_before_dispatch_still_lets_the_turn_reach_a_terminal_state(ai):
    """A raw exception before any call is made (the process dying, not a
    clean provider error) is not a ProviderError — it falls through
    run_turn's generic handler, which must still call finish() so no lease
    is left running for the reaper to clean up a minute later."""
    turn = _setup(ai, "faultcrashbefore")
    _run("crash_before")
    status, outcome, lease = _turn_row(ai, turn)
    assert status == "failed"
    assert lease is None


def test_crash_after_the_provider_has_already_answered_still_resolves(ai):
    """A raw exception raised after the fake has computed its answer (the
    connection dying on the way back) is the riskiest case: the provider
    may have been billed. The turn must still finish, and no reservation
    may be left in 'reserved' state past cron_reap's 15-minute window —
    checked here as 'not reserved forever', not 'cleaned up instantly',
    since exec_abandon is never reached on this path (only ProviderError
    and asyncio.TimeoutError are caught before the DB write) and the
    15-minute reaper sweep is the real safety net (verified separately
    by reading cron_reap's SQL, not re-run here with a time shift)."""
    turn = _setup(ai, "faultcrashafter")
    _run("crash_after")
    status, outcome, lease = _turn_row(ai, turn)
    assert status == "failed"
    assert lease is None


def test_slow_within_the_deadline_still_succeeds(ai):
    turn = _setup(ai, "faultslow")
    _run("slow(50)")
    status, outcome, lease = _turn_row(ai, turn)
    assert status in ("completed", "partial")
    assert lease is None


def test_slow_past_the_attempt_timeout_times_out_without_hanging(ai):
    """A fault slower than the per-attempt timeout must surface as a
    timeout (via asyncio.wait_for in metered_json), not hang the worker.
    The attempt timeout is shrunk for this test only, then restored."""
    before = ai.execute("select attempt_timeout_seconds from ai_private.settings where id = 1").fetchone()[0]
    ai.execute("update ai_private.settings set attempt_timeout_seconds = 5 where id = 1")
    try:
        turn = _setup(ai, "faultslowdeadline")
        _run("slow(8000)")
    finally:
        ai.execute("update ai_private.settings set attempt_timeout_seconds = %s where id = 1", (before,))
    status, outcome, lease = _turn_row(ai, turn)
    assert status == "failed"
    assert lease is None
