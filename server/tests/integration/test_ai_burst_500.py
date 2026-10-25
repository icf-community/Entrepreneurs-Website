"""S6: a local 500-submission AI burst with 2 executor processes (AI-plan
§10.1, §14 Load, programme F33). Real OS processes, not two async tasks
in one process, so this also exercises exec_claim's row-locking across
genuinely separate connections/processes, not just concurrent coroutines.

Opt-in like the other integration tests (AI_INTEGRATION_DSN, local only).
Not run in CI — it's a multi-minute local load test, exactly the plan's
"local 500-submission burst", never a per-commit gate.
"""

from __future__ import annotations

import json
import multiprocessing
import os
import threading
from concurrent.futures import ThreadPoolExecutor
import time
import uuid

import psycopg
import pytest

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")

N_MEMBERS = 500
AI_SERVICE_PASSWORD = "ai_service-local"


def _dsn_for(role: str, password: str) -> str:
    params = psycopg.conninfo.conninfo_to_dict(DSN)
    params.update(user=role, password=password, sslmode="disable")
    return psycopg.conninfo.make_conninfo(**params)


def _sql(conn, query: str, params: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall() if cur.description else None


def _batch(rows: list, size: int = 500):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


@pytest.fixture(scope="module")
def members():
    conn = psycopg.connect(DSN, autocommit=True)
    saved_flags = dict(_sql(conn, "select key, value from public.app_config where key like 'ai_%%'"))
    _sql(conn, "update public.app_config set value = 'true' where key in ('ai_enabled', 'ai_network_enabled')")
    # ai_submit_turn (20261025000002) refuses admission while any model it
    # prices is unconfirmed; every new model_prices row starts
    # confirmed=false by convention, so this fixture needs it explicit.
    _sql(conn, "update ai_private.model_prices set confirmed = true "
               "where model in ('gpt-5.4-mini', 'gpt-5.4', 'text-embedding-3-small')")
    _sql(conn, f"alter role ai_service password '{AI_SERVICE_PASSWORD}'")
    saved_capacity = _sql(conn, "select queue_capacity from ai_private.settings where id = 1")[0][0]

    tag = uuid.uuid4().hex[:8]
    ids = [uuid.uuid4() for _ in range(N_MEMBERS)]
    rows = [(uid, f"burst500-{tag}-{i}@imperial.ac.uk",
            psycopg.types.json.Jsonb({"first_name": "Burst", "surname": str(i), "role": "student",
                                      "grad_year": 2028}))
           for i, uid in enumerate(ids)]
    for batch in _batch(rows):
        values_sql = ", ".join(["(%s, %s, %s, '{\"provider\":\"email\"}', '', '', '', '', 'authenticated', "
                                "'authenticated')"] * len(batch))
        params = [p for r in batch for p in r]
        _sql(conn, f"""insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data,
               confirmation_token, recovery_token, email_change_token_new, email_change, aud, role)
             values {values_sql}""", tuple(params))
    with conn.transaction():
        _sql(conn, "select set_config('foundry.onboarding_submission', 'true', true)")
        for batch in _batch(ids):
            _sql(conn, "update public.profiles set status = 'approved', course = 'Computing' "
                       "where id = any(%s)", (batch,))
    for batch in _batch(ids):
        rows2 = [(uid,) for uid in batch]
        values_sql = ", ".join(["(%s, false, true, false, 'burst500', 1)"] * len(rows2))
        params = [p for r in rows2 for p in r]
        _sql(conn, f"""insert into ai_private.member_settings (member_id, recruiter_discoverable,
               network_discoverable, evidence_sharing, consent_version, consent_epoch)
             values {values_sql}""", tuple(params))

    yield {"conn": conn, "ids": ids, "saved_capacity": saved_capacity}

    for batch in _batch(ids):
        _sql(conn, "delete from auth.users where id = any(%s)", (batch,))
    _sql(conn, "delete from public.jobs where kind in ('refresh_member_ai', 'refresh_job_ai') and status = 'pending'")
    _sql(conn, "update ai_private.settings set queue_capacity = %s where id = 1", (saved_capacity,))
    for key, value in saved_flags.items():
        _sql(conn, "update public.app_config set value = %s where key = %s", (value, key))


def _submit_one(uid: uuid.UUID, results: list, lock: threading.Lock) -> None:
    started = time.monotonic()
    try:
        with psycopg.connect(DSN) as conn:
            with conn.transaction():
                conn.execute("set local role authenticated")
                conn.execute("select set_config('request.jwt.claims', %s, true)",
                            (json.dumps({"sub": str(uid), "role": "authenticated"}),))
                row = conn.execute(
                    "select turn_id, outcome, retry_at from public.ai_submit_turn("
                    "'network', null, null, 'message', 'python ninja', %s, null, false)",
                    (uuid.uuid4().hex,)).fetchone()
        elapsed = time.monotonic() - started
        with lock:
            results.append({"uid": uid, "turn": row[0], "outcome": row[1], "retry_at": row[2],
                           "elapsed_s": elapsed})
    except Exception as exc:  # noqa: BLE001 — recorded, never silently dropped
        with lock:
            results.append({"uid": uid, "turn": None, "outcome": f"error:{type(exc).__name__}: {exc}",
                           "retry_at": None, "elapsed_s": time.monotonic() - started})


def _executor_process(dsn: str) -> None:
    """Runs in its own OS process: claims and runs turns until the queue
    has been empty for a few consecutive polls, then exits."""
    import asyncio

    os.environ["AI_DATABASE_URL"] = dsn
    os.environ["AI_PROVIDER"] = "fake"
    from app.ai import config as ai_config
    from app.ai.db import Db
    from app.ai.pipeline import run_turn
    from app.ai.provider import FakeProvider
    from app.ai.runner import _DictionaryCache

    ai_config.ai_settings.cache_clear()
    settings = ai_config.ai_settings()

    async def go() -> None:
        db = Db(settings.database_url)
        empty_polls = 0
        try:
            while empty_polls < 5:
                ctx = await db.one("select ai_private.exec_claim(%s)", ("burst500",))
                if ctx is None:
                    empty_polls += 1
                    await asyncio.sleep(0.5)
                    continue
                empty_polls = 0
                await run_turn(db, FakeProvider(), settings, await _DictionaryCache().get(db), ctx)
        finally:
            await db.close()

    asyncio.run(go())


def test_500_submission_burst_with_two_executor_processes(members):
    conn, ids = members["conn"], members["ids"]
    capacity = 200
    _sql(conn, "update ai_private.settings set queue_capacity = %s where id = 1", (capacity,))

    # Bounded concurrency, not 500 simultaneous connections: local
    # Postgres's max_connections (100, confirmed via `show max_connections`)
    # is already shared with PostgREST/Studio/Realtime, and the browser
    # itself would never open 500 connections at once either — a pool is
    # the realistic shape of this burst, not a weaker test of it.
    results: list[dict] = []
    lock = threading.Lock()
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=30) as pool:
        list(pool.map(lambda uid: _submit_one(uid, results, lock), ids))
    submit_duration = time.monotonic() - started

    assert len(results) == N_MEMBERS, (
        f"only {len(results)}/{N_MEMBERS} submissions returned within the join timeout "
        f"(wall time for the whole pooled submission phase: {submit_duration:.1f}s)")
    errors = [r for r in results if str(r["outcome"]).startswith("error:")]
    assert not errors, f"{len(errors)} submission(s) raised: {errors[:3]}"

    outcomes = {}
    for r in results:
        outcomes[r["outcome"]] = outcomes.get(r["outcome"], 0) + 1
    assert outcomes.get("queued", 0) <= capacity, f"more turns queued than the capacity allows: {outcomes}"
    queue_full = [r for r in results if r["outcome"] == "queue_full"]
    assert all(r["retry_at"] is not None for r in queue_full), "a queue_full refusal with no retry time"

    elapsed = sorted(r["elapsed_s"] for r in results)
    p95 = elapsed[int(0.95 * len(elapsed)) - 1]
    assert p95 < 1.0, f"p95 submission latency {p95:.3f}s, expected < 1s (outcomes: {outcomes})"

    queued_turns = {r["turn"] for r in results if r["outcome"] == "queued"}

    # Sample in-flight ceilings while the two executors drain the queue.
    peak_running = 0
    peak_provider_requests = 0
    stop_sampling = threading.Event()

    def _sample() -> None:
        nonlocal peak_running, peak_provider_requests
        with psycopg.connect(DSN, autocommit=True) as sampler:
            while not stop_sampling.is_set():
                running = sampler.execute("select count(*) from ai_private.turns where status = 'running'").fetchone()[0]
                in_flight = sampler.execute(
                    "select count(*) from ai_private.spend where status = 'reserved' and purpose = 'matching'"
                ).fetchone()[0]
                peak_running = max(peak_running, running)
                peak_provider_requests = max(peak_provider_requests, in_flight)
                time.sleep(0.2)

    sampler_thread = threading.Thread(target=_sample)
    sampler_thread.start()

    ai_dsn = _dsn_for("ai_service", AI_SERVICE_PASSWORD)
    procs = [multiprocessing.Process(target=_executor_process, args=(ai_dsn,)) for _ in range(2)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(timeout=600)
    stop_sampling.set()
    sampler_thread.join(timeout=5)

    assert all(not p.is_alive() for p in procs), "an executor process did not finish within the timeout"

    ceiling, provider_ceiling = _sql(
        conn, "select active_turn_ceiling, provider_request_ceiling from ai_private.settings where id = 1")[0]
    assert peak_running <= ceiling, f"observed {peak_running} running turns, ceiling is {ceiling}"
    assert peak_provider_requests <= provider_ceiling, (
        f"observed {peak_provider_requests} in-flight provider requests, ceiling is {provider_ceiling}")

    # Every queued turn reached a terminal state — nothing left running or
    # queued once both executors report the queue empty.
    statuses = dict(_sql(conn, "select status, count(*) from ai_private.turns where id = any(%s) group by status",
                        (list(queued_turns),)))
    non_terminal = {s: c for s, c in statuses.items() if s in ("queued", "running")}
    assert not non_terminal, f"turns never reached a terminal state: {non_terminal}"

    # No reservation left dangling against a finished turn (the same
    # invariant test_ai_properties.py checks per-actor, here across the
    # whole burst).
    stuck = _sql(conn, "select count(*) from ai_private.spend s join ai_private.turns t on t.id = s.turn_id "
                "where t.id = any(%s) and s.status = 'reserved'", (list(queued_turns),))[0][0]
    assert stuck == 0, f"{stuck} reservation(s) left 'reserved' after the burst drained"

    # No cross-user leakage: every result card's target is a different
    # member who is actually network-discoverable (member_candidate_ok is
    # exactly what ai_result_cards filters through at read time; this
    # re-checks it independently rather than trusting the read path alone).
    sample_turns = list(queued_turns)[:30]
    leaks = 0
    for turn in sample_turns:
        owner = _sql(conn, "select owner_id from ai_private.turns where id = %s", (turn,))[0][0]
        targets = _sql(conn, "select target_member from ai_private.turn_candidates where turn_id = %s", (turn,))
        for (target,) in targets:
            if target == owner:
                leaks += 1
                continue
            ok = _sql(conn, "select ai_private.member_candidate_ok(%s, 'network', %s, null, '{}'::jsonb)",
                     (owner, target))[0][0]
            if not ok:
                leaks += 1
    assert leaks == 0, f"{leaks} candidate(s) sampled from the burst failed member_candidate_ok or self-matched"
