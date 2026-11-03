"""S4 gap 12: a registry of every admission/budget limit in
public.ai_submit_turn / public.ai_edit_spec / ai_private.spend_reserve,
each boundary-tested at N-1 (admitted) and N (refused), plus N+1 where
that is a distinct case. Limits with existing concurrent coverage
elsewhere are listed in LIMITS with `covered_by` instead of a fresh test
here, so test_registry_has_no_unlisted_settings_column still treats them
as accounted for.

Setup inserts rows directly (usage_events, turns, conversations, spend)
rather than driving N real submissions through the executor — the limits
are admission-time counts, so this is faster and isolates each one from
the others (e.g. testing rate_minute by actually submitting 5 turns
would hit the 2-in-flight 'busy' cap first, since nothing drains the
queue in these tests).

Opt-in like the other AI integration tests (AI_INTEGRATION_DSN, local only).
"""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from .test_concurrency import _as
from .test_ai_races import _clear_queue, _submit, ai  # noqa: F401 — fixture

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")

# name -> {column: settings column, or None if hard-coded in SQL;
#          note: the exact rule; covered_by: where it's exercised if not
#          by a function in this file (concurrency, not just the boundary)}
LIMITS = {
    "rate_minute": {"column": None, "note": "5 usage_events in the last minute refuses with rate_minute"},
    "rate_day": {"column": None, "note": "40 usage_events in the last 24h refuses with rate_day"},
    "thread_full": {"column": None, "note": "15 live turns in one conversation refuses with thread_full"},
    "too_many_threads": {"column": None, "note": "5 live conversations refuses a new one with too_many_threads"},
    "busy_per_member": {"column": None, "note": "2 queued/running turns per member refuses with busy"},
    "busy_per_conversation": {"column": None, "note": "1 queued/running turn per conversation refuses with busy"},
    "rescan_cooldown": {"column": None, "note": "a rescan within 5 minutes of the last refuses with rescan_cooldown"},
    "rescan_limit": {"column": None, "note": "10 rescans of one job in 24h refuses with rescan_limit"},
    "edit_limit": {"column": None, "note": "200 ai_edit_spec calls in a UTC day refuses with edit_limit"},
    "surface_limit": {"column": None, "note": "150 surfaced/24h; covered concurrently",
                       "covered_by": "test_ai_races.py::test_r1_admission_reserves_headroom_for_turns_already_in_flight"},
    "queue_capacity": {"column": "queue_capacity", "note": "covered concurrently",
                        "covered_by": "test_ai_admission_burst.py"},
    "active_turn_ceiling": {"column": "active_turn_ceiling", "note": "covered concurrently",
                             "covered_by": "test_ai_admission_burst.py"},
    "provider_request_ceiling": {"column": "provider_request_ceiling", "note": "boundary tested here"},
    "member_daily_token_cap": {"column": "member_daily_token_cap", "note": "at-the-limit covered elsewhere",
                                "covered_by": "test_ai_races.py::test_the_member_token_ceiling_refuses_past_the_daily_allowance"},
    "matching_daily_cap_micro": {"column": "matching_daily_cap_micro", "note": "boundary tested here"},
    "matching_monthly_cap_micro": {"column": "matching_monthly_cap_micro", "note": "boundary tested here"},
    "controller_daily_cap_micro": {"column": "controller_daily_cap_micro", "note": "boundary tested here"},
    "ingestion_daily_cap_micro": {"column": "ingestion_daily_cap_micro", "note": "covered concurrently (R11)",
                                   "covered_by": "test_ai_races.py::test_r11_twenty_concurrent_reservations_never_overspend"},
    "member_daily_cap_micro": {"column": "member_daily_cap_micro", "note": "covered concurrently (R11)",
                                "covered_by": "test_ai_races.py::test_r11_twenty_concurrent_reservations_never_overspend"},
    "ingestion_member_daily_cap_micro": {"column": "ingestion_member_daily_cap_micro", "note": "boundary tested here"},
}

# Settings columns that are timing/deadline knobs, not admission counts —
# covered by S0's timeout work and gap-39 remeasurement, not this registry.
_NOT_ADMISSION_LIMITS = {"max_queue_wait_seconds", "turn_deadline_seconds", "attempt_timeout_seconds"}


def test_registry_has_no_unlisted_settings_column(ai):
    """Fails if a future migration adds a settings column with a check
    constraint (i.e. a new limit) and nobody adds it to LIMITS above."""
    columns = {r[0] for r in ai.execute(
        "select column_name from information_schema.columns "
        "where table_schema = 'ai_private' and table_name = 'settings' "
        "and column_name not in ('id', 'previous', 'updated_at', 'updated_by', 'reason')").fetchall()}
    registered = {v["column"] for v in LIMITS.values() if v["column"]}
    assert columns - registered - _NOT_ADMISSION_LIMITS == set()


def _events(ai, uid, kind, count, *, age_seconds=30):
    for _ in range(count):
        ai.execute("insert into ai_private.usage_events (owner_id, mode, kind, created_at) "
                   "values (%s, 'network', %s, now() - make_interval(secs => %s))", (uid, kind, age_seconds))


def test_rate_minute_boundary(ai):
    uid = ai.member("limratemin")
    _events(ai, uid, "message", 4, age_seconds=10)
    assert _submit(ai, uid, "python")[2] == "queued"
    _events(ai, uid, "message", 1, age_seconds=10)  # now 5 in the window (the just-admitted one + this)
    outcome = _submit(ai, uid, "rust")[2]
    assert outcome == "rate_minute", outcome


def test_rate_day_boundary(ai):
    uid = ai.member("limrateday")
    # Outside the 1-minute window so only the daily check is exercised.
    _events(ai, uid, "message", 39, age_seconds=7200)
    assert _submit(ai, uid, "python", conversation=None)[2] == "queued"
    _events(ai, uid, "message", 1, age_seconds=7200)  # 40 prior events now
    outcome = _submit(ai, uid, "rust")[2]
    assert outcome == "rate_day", outcome


def test_thread_full_boundary(ai):
    uid = ai.member("limthreadfull")
    turn, conv, outcome = _submit(ai, uid, "python")
    assert outcome == "queued"
    ai.execute("update ai_private.turns set status = 'completed', lease_token = null where id = %s", (turn,))
    for _ in range(13):  # 1 (above) + 13 = 14 = N-1
        ai.execute("insert into ai_private.turns (conversation_id, owner_id, mode, kind, idempotency_key, "
                   "body_digest, expected_revision, status) "
                   "values (%s, %s, 'network', 'message', %s, 'x', 0, 'completed')",
                   (conv, uid, uuid.uuid4().hex))
    outcome = _submit(ai, uid, "n-1 check", conversation=conv, revision=0)[2]
    assert outcome == "queued", outcome
    ai.execute("insert into ai_private.turns (conversation_id, owner_id, mode, kind, idempotency_key, "
               "body_digest, expected_revision, status) "
               "values (%s, %s, 'network', 'message', %s, 'x', 0, 'completed')",
               (conv, uid, uuid.uuid4().hex))  # now 15
    outcome = _submit(ai, uid, "n check", conversation=conv, revision=0)[2]
    assert outcome == "thread_full", outcome


def test_too_many_threads_boundary(ai):
    uid = ai.member("limthreads")
    for i in range(4):
        conv = ai.execute("insert into ai_private.conversations (owner_id, mode, spec) "
                          "values (%s, 'network', '{\"schema_version\":1,\"atoms\":[],\"next_id\":1}') "
                          "returning id", (uid,)).fetchone()[0]
        ai.execute("insert into ai_private.messages (conversation_id, owner_id, role, kind, body) "
                   "values (%s, %s, 'member', 'message', 'x')", (conv, uid))
    outcome = _submit(ai, uid, "n-1 check")[2]  # 4 existing + this makes 5
    assert outcome == "queued", outcome
    conv2 = ai.execute("insert into ai_private.conversations (owner_id, mode, spec) "
                       "values (%s, 'network', '{\"schema_version\":1,\"atoms\":[],\"next_id\":1}') "
                       "returning id", (uid,)).fetchone()[0]
    ai.execute("insert into ai_private.messages (conversation_id, owner_id, role, kind, body) "
               "values (%s, %s, 'member', 'message', 'x')", (conv2, uid))  # now 5 existing
    outcome = _submit(ai, uid, "n check")[2]
    assert outcome == "too_many_threads", outcome


def test_busy_per_member_boundary(ai):
    uid = ai.member("limbusymember")
    first = _submit(ai, uid, "python")
    assert first[2] == "queued"
    second = _submit(ai, uid, "rust")
    assert second[2] == "queued"  # N-1 in-flight (1) -> this is the 2nd, still allowed
    third = _submit(ai, uid, "go")
    assert third[2] == "busy", third  # a 3rd with 2 already queued/running


def test_busy_per_conversation_boundary(ai):
    uid = ai.member("limbusyconv")
    turn, conv, outcome = _submit(ai, uid, "python")
    assert outcome == "queued"
    again = _submit(ai, uid, "more criteria", conversation=conv, revision=0)
    assert again[2] == "busy", again


def _call_as(ai, uid, sql, params):
    with ai.transaction(), ai.cursor() as cur:
        _as(cur, uid)
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _submit_rescan(ai, uid, opportunity, conversation):
    with ai.transaction(), ai.cursor() as cur:
        _as(cur, uid)
        cur.execute("select turn_id, conversation_id, outcome from public.ai_submit_turn("
                   "'recruiter', %s, %s, 'rescan', null, %s, 0, false)",
                   (conversation, opportunity, uuid.uuid4().hex))
        return cur.fetchone()


def test_rescan_cooldown_and_limit_boundary(ai):
    recruiter = ai.member("limrescan")
    job = ai.execute(
        """insert into public.opportunities (posted_by, status, position_name, company, pay, location_type,
             description, start_month, start_year, application_deadline, contact_email, apply_method,
             approved_at, approved_by, eligible_audience, creation_source)
           values (%s, 'approved', 'Analyst', 'Beta', 'Paid', 'remote',
             'Analyst role using Python and SQL dashboards for the team.', 6, 2027, current_date + 30,
             'jobs@beta.test', 'email', now(), %s, 'both', 'member')
           returning id""", (recruiter, recruiter)).fetchone()[0]
    ai.execute("insert into ai_private.job_requirements (opportunity_id, status, confirmed, content_version) "
               "select %s, 'confirmed', '[]'::jsonb, o.content_version from public.opportunities o where o.id = %s",
               (job, job))
    turn, conv, outcome = _submit(ai, recruiter, "python", mode="recruiter", opportunity=job)
    assert outcome == "queued", outcome
    ai.execute("update ai_private.turns set status = 'completed', lease_token = null where id = %s", (turn,))
    try:
        # cooldown: one rescan 2 minutes ago refuses a second now.
        ai.execute("insert into ai_private.usage_events (owner_id, mode, kind, created_at) "
                   "values (%s, 'recruiter', %s, now() - interval '2 minutes')",
                   (recruiter, f"rescan:{job}"))
        outcome = _submit_rescan(ai, recruiter, job, conv)[2]
        assert outcome == "rescan_cooldown", outcome
        ai.execute("delete from ai_private.usage_events where owner_id = %s and kind like 'rescan:%%'", (recruiter,))
        # daily limit: 9 rescans outside the cooldown (N-1) admits; a 10th refuses.
        for _ in range(9):
            ai.execute("insert into ai_private.usage_events (owner_id, mode, kind, created_at) "
                       "values (%s, 'recruiter', %s, now() - interval '10 minutes')",
                       (recruiter, f"rescan:{job}"))
        outcome = _submit_rescan(ai, recruiter, job, conv)[2]
        assert outcome == "queued", outcome
        ai.execute("update ai_private.turns set status = 'completed', lease_token = null "
                   "where owner_id = %s and kind = 'rescan'", (recruiter,))
        # Isolate the limit check from the cooldown check: wipe the event
        # that admission just recorded (it's "now", which would trip the
        # cooldown branch before the count branch is ever reached) and
        # replay exactly 10, all outside the cooldown window.
        ai.execute("delete from ai_private.usage_events where owner_id = %s and kind like 'rescan:%%'", (recruiter,))
        for _ in range(10):
            ai.execute("insert into ai_private.usage_events (owner_id, mode, kind, created_at) "
                       "values (%s, 'recruiter', %s, now() - interval '10 minutes')", (recruiter, f"rescan:{job}"))
        outcome = _submit_rescan(ai, recruiter, job, conv)[2]
        assert outcome == "rescan_limit", outcome
    finally:
        ai.execute("delete from ai_private.turns where owner_id = %s", (recruiter,))
        ai.execute("delete from public.opportunities where id = %s", (job,))


def test_edit_limit_boundary(ai):
    uid = ai.member("limedit")
    turn, conv, outcome = _submit(ai, uid, "python")
    assert outcome == "queued"
    ai.execute("update ai_private.turns set status = 'completed', lease_token = null where id = %s", (turn,))
    ai.execute("update ai_private.conversations set spec = spec || jsonb_build_object("
               "'edits_today', 199, 'edits_day', current_date::text) where id = %s", (conv,))
    rev = ai.execute("select spec_revision from ai_private.conversations where id = %s", (conv,)).fetchone()[0]
    # N-1 = 199 recorded edits: one more is the 200th and must still be admitted.
    _call_as(ai, uid, "select * from public.ai_edit_spec(%s, %s, %s)",
            (conv, rev, '[{"op": "add", "kind": "tool", "concept": "python", "required": false, "negated": false}]'))
    ai.execute("update ai_private.conversations set spec = spec || jsonb_build_object("
               "'edits_today', 200, 'edits_day', current_date::text) where id = %s", (conv,))
    rev = ai.execute("select spec_revision from ai_private.conversations where id = %s", (conv,)).fetchone()[0]
    with pytest.raises(psycopg.errors.ProgramLimitExceeded, match="edit_limit"):
        _call_as(ai, uid, "select * from public.ai_edit_spec(%s, %s, %s)",
                (conv, rev, '[{"op": "add", "kind": "tool", "concept": "rust", "required": false, "negated": false}]'))


def test_provider_request_ceiling_boundary(ai):
    _clear_queue(ai)
    uid = ai.member("limprovider")
    turn, conv, outcome = _submit(ai, uid, "python")
    assert outcome == "queued"
    ctx = ai.execute("select ai_private.exec_claim('limit-test')").fetchone()[0]
    saved = ai.execute("select provider_request_ceiling from ai_private.settings where id = 1").fetchone()[0]
    # Relative to whatever's already reserved elsewhere in this run (the
    # check counts every member's 'matching' reservations in the last two
    # minutes, not just this test's), the same way R11 measures a baseline
    # before setting a cap — an absolute small ceiling is flaky under a
    # full-suite run where other tests still hold recent reservations.
    baseline = ai.execute("select count(*) from ai_private.spend where status = 'reserved' and purpose = 'matching' "
                         "and created_at > now() - interval '2 minutes'").fetchone()[0]
    try:
        ai.execute("update ai_private.settings set provider_request_ceiling = %s where id = 1", (baseline + 3,))
        for _ in range(2):  # N-1 of this test's own reservations, on top of the baseline
            ai.execute("insert into ai_private.spend (purpose, mode, member_id, turn_id, stage, model, "
                       "price_version, max_input_tokens, max_output_tokens, reserved_micro, status, created_at) "
                       "values ('matching', 'network', %s, %s, 'race', 'fake-mini', 1, 10, 10, 10, 'reserved', now())",
                       (uid, turn))
        reservation = ai.execute("select ai_private.exec_reserve(%s, %s, 'interpret', 'fake-mini', 10, 10)",
                                 (turn, ctx["lease"])).fetchone()[0]
        assert reservation is not None
        ai.execute("insert into ai_private.spend (purpose, mode, member_id, turn_id, stage, model, "
                   "price_version, max_input_tokens, max_output_tokens, reserved_micro, status, created_at) "
                   "values ('matching', 'network', %s, %s, 'race', 'fake-mini', 1, 10, 10, 10, 'reserved', now())",
                   (uid, turn))  # now 3 reserved (at the ceiling)
        with pytest.raises(psycopg.errors.RaiseException, match="provider_busy"):
            ai.execute("select ai_private.exec_reserve(%s, %s, 'interpret', 'fake-mini', 10, 10)", (turn, ctx["lease"]))
    finally:
        ai.execute("update ai_private.settings set provider_request_ceiling = %s where id = 1", (saved,))
        ai.execute("update ai_private.spend set status = 'released' where turn_id = %s", (turn,))


def _money_bound(ai, model="fake-mini", max_in=1000, max_out=0):
    price = ai.execute("select input_micro_per_mtok, output_micro_per_mtok from ai_private.model_prices "
                       "where model = %s", (model,)).fetchone()
    import math
    return math.ceil((max_in * price[0] + max_out * price[1]) / 1_000_000)


def _spent_today(ai, purpose, *, member=None, this_month=False, all_purposes=False):
    scope = "s.day >= date_trunc('month', now() at time zone 'utc')::date" if this_month \
        else "s.day = (now() at time zone 'utc')::date"
    purpose_clause = "" if all_purposes else "and s.purpose = %s"
    member_clause = "and s.member_id = %s" if member else ""
    params = (() if all_purposes else (purpose,)) + ((member,) if member else ())
    row = ai.execute(
        f"select coalesce(sum(case when s.status = 'settled' then s.settled_micro else s.reserved_micro end), 0) "
        f"from ai_private.spend s where s.status <> 'released' and {scope} {purpose_clause} {member_clause}",
        params).fetchone()
    return row[0]


# "Out of play" for a boundary test means as high as the column may go. Since
# 20261026000010 the money caps have hard ceilings (sized to the $150/month
# budget), so 10**12 is no longer writable; the controller cap has none.
_CEILING = {
    "member_daily_cap_micro": 1_000_000,
    "matching_daily_cap_micro": 10_000_000,
    "matching_monthly_cap_micro": 150_000_000,
    "controller_daily_cap_micro": 10**12,
    "ingestion_daily_cap_micro": 10**12,
    "ingestion_member_daily_cap_micro": 1_000_000,  # the CHECK ceiling from 20261026000017
}

_OTHER_DAILY_CAPS = {
    "controller_daily_cap_micro": ["matching_daily_cap_micro", "member_daily_cap_micro"],
    "matching_daily_cap_micro": ["controller_daily_cap_micro", "member_daily_cap_micro"],
    "member_daily_cap_micro": ["controller_daily_cap_micro", "matching_daily_cap_micro"],
}


@pytest.mark.parametrize("column,expect,all_purposes,scoped_to_member", [
    ("controller_daily_cap_micro", "budget_exhausted: controller_daily", True, False),
    ("matching_daily_cap_micro", "budget_exhausted: matching_daily", False, False),
    ("member_daily_cap_micro", "budget_exhausted: member_daily", False, True),
])
def test_daily_money_cap_boundary(ai, column, expect, all_purposes, scoped_to_member):
    uid = ai.member("limmoney" + column[:6])
    one = _money_bound(ai)
    baseline = _spent_today(ai, "matching", member=uid if scoped_to_member else None, all_purposes=all_purposes)
    others = _OTHER_DAILY_CAPS[column]
    saved = ai.execute(f"select {column}, " + ", ".join(others) + " from ai_private.settings where id = 1").fetchone()
    member_arg = uid if scoped_to_member else None
    try:
        ai.execute("update ai_private.settings set " + ", ".join(f"{c} = %s" for c in others) + " where id = 1",
                  tuple(_CEILING[c] for c in others))
        ai.execute(f"update ai_private.settings set {column} = %s where id = 1", (baseline + one - 1,))
        with pytest.raises(psycopg.errors.RaiseException, match=expect):
            ai.execute("select ai_private.spend_reserve('matching', 'network', %s, null, null, 'limtest', "
                      "'fake-mini', 1000, 0)", (member_arg,))
        ai.execute(f"update ai_private.settings set {column} = %s where id = 1", (baseline + one,))
        ok = ai.execute("select ai_private.spend_reserve('matching', 'network', %s, null, null, 'limtest', "
                        "'fake-mini', 1000, 0)", (member_arg,)).fetchone()[0]
        assert ok is not None
    finally:
        ai.execute(f"update ai_private.settings set {column} = %s, " + ", ".join(f"{c} = %s" for c in others) +
                  " where id = 1", (saved[0], *saved[1:]))
        ai.execute("update ai_private.spend set status = 'released' where stage = 'limtest'")


def test_ingestion_member_daily_cap_boundary(ai):
    """20261026000017: one member's ingestion spend is capped per day, on its own. N-1 refuses,
    N admits; another member is unaffected; the same member's MATCHING spend is a different
    budget and is not counted against it."""
    a = ai.member("limingA")
    b = ai.member("limingB")
    one = _money_bound(ai)
    baseline = _spent_today(ai, "ingestion", member=a)
    saved = ai.execute("select ingestion_member_daily_cap_micro, ingestion_daily_cap_micro, "
                       "controller_daily_cap_micro from ai_private.settings where id = 1").fetchone()
    ingest = "select ai_private.spend_reserve('ingestion', null, %s, null, null, 'limtest', 'fake-mini', 1000, 0)"
    try:
        ai.execute("update ai_private.settings set ingestion_daily_cap_micro = %s, controller_daily_cap_micro = %s "
                   "where id = 1", (_CEILING["ingestion_daily_cap_micro"], _CEILING["controller_daily_cap_micro"]))
        # A spends one reservation; the cap leaves room for exactly one more.
        ai.execute("update ai_private.settings set ingestion_member_daily_cap_micro = %s where id = 1", (baseline + 2 * one,))
        assert ai.execute(ingest, (a,)).fetchone()[0] is not None
        # N-1: A (already at one) is refused. B has spent nothing, and A's MATCHING spend is a
        # different budget, so both are admitted under the same cap.
        ai.execute("update ai_private.settings set ingestion_member_daily_cap_micro = %s where id = 1", (baseline + 2 * one - 1,))
        with pytest.raises(psycopg.errors.RaiseException, match="budget_exhausted: ingestion_member_daily"):
            ai.execute(ingest, (a,))
        assert ai.execute(ingest, (b,)).fetchone()[0] is not None
        assert ai.execute("select ai_private.spend_reserve('matching', 'network', %s, null, null, 'limtest', "
                          "'fake-mini', 1000, 0)", (a,)).fetchone()[0] is not None
        # N: exactly at the cap is admitted, and the reservation just made counts, so the next is over.
        ai.execute("update ai_private.settings set ingestion_member_daily_cap_micro = %s where id = 1", (baseline + 2 * one,))
        assert ai.execute(ingest, (a,)).fetchone()[0] is not None
        with pytest.raises(psycopg.errors.RaiseException, match="budget_exhausted: ingestion_member_daily"):
            ai.execute(ingest, (a,))
        # A reservation with no member (refresh_job_ai) has no member to cap.
        assert ai.execute("select ai_private.spend_reserve('ingestion', null, null, null, null, 'limtest', "
                          "'fake-mini', 1000, 0)").fetchone()[0] is not None
    finally:
        ai.execute("update ai_private.settings set ingestion_member_daily_cap_micro = %s, ingestion_daily_cap_micro = %s, "
                   "controller_daily_cap_micro = %s where id = 1", saved)
        ai.execute("update ai_private.spend set status = 'released' where stage = 'limtest'")


def test_matching_monthly_cap_boundary(ai):
    one = _money_bound(ai)
    baseline = _spent_today(ai, "matching", this_month=True)
    saved = ai.execute("select matching_monthly_cap_micro, matching_daily_cap_micro, controller_daily_cap_micro "
                       "from ai_private.settings where id = 1").fetchone()
    try:
        ai.execute("update ai_private.settings set matching_daily_cap_micro = %s, controller_daily_cap_micro = %s "
                   "where id = 1", (_CEILING["matching_daily_cap_micro"], _CEILING["controller_daily_cap_micro"]))
        ai.execute("update ai_private.settings set matching_monthly_cap_micro = %s where id = 1", (baseline + one - 1,))
        with pytest.raises(psycopg.errors.RaiseException, match="budget_exhausted: matching_monthly"):
            ai.execute("select ai_private.spend_reserve('matching', 'network', null, null, null, 'limmonth', "
                      "'fake-mini', 1000, 0)")
        ai.execute("update ai_private.settings set matching_monthly_cap_micro = %s where id = 1", (baseline + one,))
        ok = ai.execute("select ai_private.spend_reserve('matching', 'network', null, null, null, 'limmonth', "
                        "'fake-mini', 1000, 0)").fetchone()[0]
        assert ok is not None
    finally:
        ai.execute("update ai_private.settings set matching_monthly_cap_micro = %s, matching_daily_cap_micro = %s, "
                   "controller_daily_cap_micro = %s where id = 1", saved)
        ai.execute("update ai_private.spend set status = 'released' where stage = 'limmonth'")
