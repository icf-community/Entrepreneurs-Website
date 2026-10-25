"""Admission under concurrency, against the real database (AI-plan §9,
§14 Concurrency/cost gate; programme A0.5's local burst).

* The same idempotency key from many connections at once makes exactly one
  turn; every other caller gets that same turn back.
* A burst larger than the queue bound is admitted up to the bound and
  refused after it, before any provider work exists to be paid for.
* Nothing in the burst reserves money: reservations happen only when the
  executor runs a turn.

Opt-in like the other integration tests (AI_INTEGRATION_DSN).
"""

from __future__ import annotations

import json
import os
import threading
import uuid

import psycopg
import pytest

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")


def _member_submit(uid: uuid.UUID, key: str, message: str, results: list, barrier: threading.Barrier) -> None:
    with psycopg.connect(DSN) as conn:
        with conn.transaction():
            conn.execute("set local role authenticated")
            conn.execute("select set_config('request.jwt.claims', %s, true)",
                         (json.dumps({"sub": str(uid), "role": "authenticated"}),))
            barrier.wait()
            try:
                row = conn.execute(
                    "select turn_id, outcome from public.ai_submit_turn('network', null, null, 'message', %s, %s, null, false)",
                    (message, key),
                ).fetchone()
                results.append(row)
            except psycopg.errors.UniqueViolation:
                # Lost the insert race on the idempotency constraint: the
                # browser retries, and the retry gets the winner's turn.
                results.append((None, "race"))


@pytest.fixture(scope="module")
def members():
    conn = psycopg.connect(DSN, autocommit=True)
    saved = dict(conn.execute("select key, value from public.app_config where key like 'ai_%'").fetchall())
    saved_capacity = conn.execute("select queue_capacity from ai_private.settings where id = 1").fetchone()[0]
    conn.execute("update public.app_config set value = 'true' where key in ('ai_enabled', 'ai_network_enabled')")
    # ai_submit_turn (20261025000002) refuses admission while any model it
    # prices is unconfirmed; every new model_prices row starts
    # confirmed=false by convention, so this fixture needs it explicit.
    conn.execute("update ai_private.model_prices set confirmed = true "
                 "where model in ('gpt-5.4-mini', 'gpt-5.4', 'text-embedding-3-small')")
    ids = []
    tag = uuid.uuid4().hex[:6]
    for i in range(16):
        uid = uuid.uuid4()
        conn.execute(
            """insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token,
                 recovery_token, email_change_token_new, email_change, aud, role)
               values (%s, %s, %s, '{"provider":"email"}', '', '', '', '', 'authenticated', 'authenticated')""",
            (uid, f"burst-{tag}-{i}@imperial.ac.uk",
             json.dumps({"first_name": "Burst", "surname": f"M{i}", "role": "student", "grad_year": 2028})),
        )
        with conn.transaction():
            conn.execute("select set_config('foundry.onboarding_submission', 'true', true)")
            conn.execute("update public.profiles set status = 'approved', course = 'Computing' where id = %s", (uid,))
        ids.append(uid)
    # Nothing else may be queued, so the bound below is exact.
    conn.execute("update ai_private.turns set status = 'cancelled' where status = 'queued'")
    yield conn, ids
    conn.execute("update ai_private.settings set queue_capacity = %s where id = 1", (saved_capacity,))
    for uid in ids:
        conn.execute("delete from auth.users where id = %s", (uid,))
    for k, v in saved.items():
        conn.execute("update public.app_config set value = %s where key = %s", (v, k))
    conn.close()


def test_one_idempotency_key_makes_one_turn_under_concurrency(members):
    conn, ids = members
    uid, key = ids[0], uuid.uuid4().hex
    results: list = []
    barrier = threading.Barrier(8)
    threads = [threading.Thread(target=_member_submit, args=(uid, key, "python", results, barrier)) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    turns = conn.execute("select count(*) from ai_private.turns where owner_id = %s and idempotency_key = %s",
                         (uid, key)).fetchone()[0]
    assert turns == 1
    ids_returned = {r[0] for r in results if r[0] is not None}
    assert len(ids_returned) == 1, results
    assert {r[1] for r in results} <= {"queued", "duplicate", "race"}


def test_a_burst_beyond_the_queue_bound_is_refused_before_any_spend(members):
    conn, ids = members
    conn.execute("update ai_private.turns set status = 'cancelled' where status = 'queued'")
    queued_now = conn.execute("select count(*) from ai_private.turns where status = 'queued'").fetchone()[0]
    conn.execute("update ai_private.settings set queue_capacity = %s where id = 1", (queued_now + 10,))
    spend_before = conn.execute("select count(*) from ai_private.spend where purpose = 'matching'").fetchone()[0]

    results: list = []
    barrier = threading.Barrier(15)
    threads = [threading.Thread(target=_member_submit, args=(uid, uuid.uuid4().hex, "rust", results, barrier))
               for uid in ids[1:16]]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    outcomes = [r[1] for r in results]
    queued = outcomes.count("queued")
    assert queued <= 10 and outcomes.count("queue_full") >= 5, outcomes
    assert queued + outcomes.count("queue_full") == 15
    spend_after = conn.execute("select count(*) from ai_private.spend where purpose = 'matching'").fetchone()[0]
    assert spend_after == spend_before, "admission reserves nothing; only a running turn does"


def test_concurrent_claims_never_exceed_the_active_ceiling(members):
    conn, _ = members
    queued = conn.execute("select count(*) from ai_private.turns where status = 'queued'").fetchone()[0]
    assert queued >= 3, "the burst test above leaves turns queued"
    saved = conn.execute("select active_turn_ceiling from ai_private.settings where id = 1").fetchone()[0]
    running = conn.execute("select count(*) from ai_private.turns where status = 'running' and lease_expires_at > now()").fetchone()[0]
    conn.execute("update ai_private.settings set active_turn_ceiling = %s where id = 1", (running + 1,))
    claimed: list = []
    barrier = threading.Barrier(6)

    def claim() -> None:
        with psycopg.connect(DSN, autocommit=True) as c:
            barrier.wait()
            claimed.append(c.execute("select ai_private.exec_claim('burst-test')").fetchone()[0])

    try:
        threads = [threading.Thread(target=claim) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sum(1 for c in claimed if c is not None) == 1, claimed
    finally:
        conn.execute("update ai_private.settings set active_turn_ceiling = %s where id = 1", (saved,))
        conn.execute("update ai_private.turns set status = 'cancelled', lease_token = null "
                     "where status in ('queued', 'running') and owner_id = any(%s)", (members[1],))
