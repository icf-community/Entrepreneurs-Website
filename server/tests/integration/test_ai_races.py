"""AI races (programme S1, AI-plan §14 Concurrency/cost and §14.1).

Like test_concurrency.py, the interleaving is forced: the first call's
transaction holds its locks while the second runs. Executor RPCs accept a
postgres session (exec_turn's session_user guard), so the tests drive the
lease, fence and publish steps directly instead of through a provider.

Opt-in like the other integration tests (AI_INTEGRATION_DSN, local only).
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import uuid

import psycopg
import pytest

from .test_concurrency import _as, _one, hold_then_race

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.fixture(scope="module")
def ai():
    conn = psycopg.connect(DSN, autocommit=True)
    saved = dict(conn.execute("select key, value from public.app_config where key like 'ai_%%'").fetchall())
    conn.execute("update public.app_config set value = 'true' where key in "
                 "('ai_enabled', 'ai_network_enabled', 'ai_recruiter_enabled')")
    # ai_submit_turn (20261025000002) refuses admission while any model it
    # prices is unconfirmed; every new model_prices row starts
    # confirmed=false by convention, so this fixture needs it explicit.
    conn.execute("update ai_private.model_prices set confirmed = true "
                 "where model in ('gpt-5.4-mini', 'gpt-5.4', 'text-embedding-3-small')")
    tag = uuid.uuid4().hex[:6]
    created: list[uuid.UUID] = []

    def member(name: str, *, open_to_connections: bool = True, enrolled: bool = True) -> uuid.UUID:
        uid = uuid.uuid4()
        conn.execute(
            """insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token,
                 recovery_token, email_change_token_new, email_change, aud, role)
               values (%s, %s, %s, '{"provider":"email"}', '', '', '', '', 'authenticated', 'authenticated')""",
            (uid, f"race-{name}-{tag}@imperial.ac.uk",
             json.dumps({"first_name": "Race", "surname": name.title(), "role": "student", "grad_year": 2028})))
        with conn.transaction():
            conn.execute("select set_config('foundry.onboarding_submission', 'true', true)")
            conn.execute("update public.profiles set status = 'approved', course = 'Computing', "
                         "open_to_connections = %s where id = %s", (open_to_connections, uid))
        conn.execute("insert into public.member_education (member_id, currently_enrolled, has_completed_degree) "
                     "values (%s, %s, %s) on conflict do nothing", (uid, enrolled, not enrolled))
        created.append(uid)
        return uid

    def candidate(name: str) -> uuid.UUID:
        uid = member(name)
        conn.execute(
            """insert into ai_private.member_docs (member_id, purpose, source_version, consent_epoch, policy_version,
                 projection_hash, concepts, body)
               values (%s, 'network', 1, 1, 'test', %s, '{python}', 'Python projects')""", (uid, _hash(str(uid))))
        return uid

    conn.member = member  # type: ignore[attr-defined]
    conn.candidate = candidate  # type: ignore[attr-defined]
    # Nothing else may be claimable, so exec_claim picks the turn a test made.
    conn.execute("update ai_private.turns set status = 'cancelled', lease_token = null where status in ('queued', 'running')")
    yield conn
    for uid in created:
        conn.execute("delete from public.opportunities where posted_by = %s", (uid,))
        conn.execute("delete from auth.users where id = %s", (uid,))
    conn.execute("delete from public.jobs where kind in ('refresh_member_ai', 'refresh_job_ai') and status = 'pending'")
    for key, value in saved.items():
        conn.execute("update public.app_config set value = %s where key = %s", (value, key))
    conn.close()


def _submit(conn, uid, message: str = "python", *, mode: str = "network", conversation=None, opportunity=None,
            revision=None):
    with conn.transaction(), conn.cursor() as cur:
        _as(cur, uid)
        cur.execute("select turn_id, conversation_id, outcome from public.ai_submit_turn(%s, %s, %s, 'message', %s, %s, %s, false)",
                    (mode, conversation, opportunity, message, uuid.uuid4().hex, revision))
        return cur.fetchone()


def _claim(conn) -> dict:
    ctx = conn.execute("select ai_private.exec_claim('race-test')").fetchone()[0]
    assert ctx, "nothing to claim"
    return ctx


def _revision(conn, conversation) -> int:
    return conn.execute("select spec_revision from ai_private.conversations where id = %s", (conversation,)).fetchone()[0]


def _issue(conn, turn, targets) -> None:
    for i, t in enumerate(targets, 1):
        conn.execute("insert into ai_private.turn_candidates (turn_id, target_member, rank, projection_hash) "
                     "values (%s, %s, %s, %s)", (turn, t, i, _hash(str(t))))


def _results(targets) -> str:
    return json.dumps([{"target": str(t), "projection_hash": _hash(str(t)), "score": 80, "tier": "meets"} for t in targets])


def _publish_sql():
    return "select ai_private.exec_publish(%s, %s, %s, %s, %s::jsonb, false)"


def _clear_queue(conn) -> None:
    conn.execute("update ai_private.turns set status = 'cancelled', lease_token = null where status in ('queued', 'running')")


# ─── R1: the surfaced-members cap ───────────────────────────────────
def test_r1_admission_reserves_headroom_for_turns_already_in_flight(ai):
    """At 135 surfaced, one turn (+10) fits and a second does not: both
    may publish 10. Before: the second was admitted too."""
    _clear_queue(ai)
    owner = ai.member("r1owner")
    seen = [ai.member(f"r1seen{i}") for i in range(135)]
    for s in seen:
        ai.execute("insert into ai_private.surfaced_members (owner_id, member_id) values (%s, %s)", (owner, s))
    first = _submit(ai, owner, "python")
    second = _submit(ai, owner, "rust")
    assert first[2] == "queued"
    assert second[2] == "surface_limit", second


def test_r1_publication_never_surfaces_past_150(ai):
    _clear_queue(ai)
    owner = ai.member("r1pub")
    seen = [ai.member(f"r1pseen{i}") for i in range(145)]
    for s in seen:
        ai.execute("insert into ai_private.surfaced_members (owner_id, member_id) values (%s, %s)", (owner, s))
    # Admission now refuses at 145 + 10 > 150, so queue the turn directly:
    # this is the publish-side backstop for a turn admitted before others
    # finished.
    ai.execute("update ai_private.surfaced_members set surfaced_at = now() - interval '25 hours' where owner_id = %s", (owner,))
    turn, conv, outcome = _submit(ai, owner, "python")
    assert outcome == "queued"
    ai.execute("update ai_private.surfaced_members set surfaced_at = now() where owner_id = %s", (owner,))
    ctx = _claim(ai)
    new = [ai.candidate(f"r1new{i}") for i in range(10)]
    _issue(ai, turn, new)
    published = ai.execute(_publish_sql(), (turn, ctx["lease"], ctx["fence"], _revision(ai, conv), _results(new))).fetchone()[0]
    assert published == 5
    total = ai.execute("select count(*) from ai_private.surfaced_members where owner_id = %s", (owner,)).fetchone()[0]
    assert total == 150


# ─── R2/R3/R5: a turn that lost its authority publishes nothing ─────
def test_r2_a_reaped_lease_cannot_publish(ai):
    _clear_queue(ai)
    owner = ai.member("r2")
    turn, conv, _ = _submit(ai, owner)
    ctx = _claim(ai)
    ai.execute("update ai_private.turns set lease_expires_at = now() - interval '1 minute' where id = %s", (turn,))
    ai.execute("select ai_private.cron_reap()")
    with pytest.raises(psycopg.errors.RaiseException, match="stale_lease"):
        ai.execute(_publish_sql(), (turn, ctx["lease"], ctx["fence"], _revision(ai, conv), "[]"))
    assert ai.execute("select status from ai_private.turns where id = %s", (turn,)).fetchone()[0] == "failed"


def test_r3_a_cancel_during_assessment_publishes_nothing(ai):
    """Before: exec_publish ignored cancel_requested, so a member who
    cancelled still got results once the in-flight calls returned."""
    _clear_queue(ai)
    owner = ai.member("r3")
    turn, conv, _ = _submit(ai, owner)
    ctx = _claim(ai)
    cand = ai.candidate("r3cand")
    _issue(ai, turn, [cand])
    with ai.transaction(), ai.cursor() as cur:
        _as(cur, owner)
        cur.execute("select public.ai_cancel_turn(%s)", (turn,))
    with pytest.raises(psycopg.errors.RaiseException, match="cancelled"):
        ai.execute(_publish_sql(), (turn, ctx["lease"], ctx["fence"], _revision(ai, conv), _results([cand])))
    assert ai.execute("select count(*) from ai_private.results where turn_id = %s", (turn,)).fetchone()[0] == 0


def test_r5_deleting_the_conversation_mid_turn_leaves_nothing(ai):
    _clear_queue(ai)
    owner = ai.member("r5")
    turn, conv, _ = _submit(ai, owner)
    ctx = _claim(ai)
    cand = ai.candidate("r5cand")
    _issue(ai, turn, [cand])
    with ai.transaction(), ai.cursor() as cur:
        _as(cur, owner)
        cur.execute("select public.ai_delete_conversation(%s)", (conv,))
    with pytest.raises(psycopg.errors.RaiseException, match="stale_lease"):
        ai.execute(_publish_sql(), (turn, ctx["lease"], ctx["fence"], 0, _results([cand])))
    for table, col in (("turns", "id"), ("turn_candidates", "turn_id"), ("results", "turn_id")):
        assert ai.execute(f"select count(*) from ai_private.{table} where {col} = %s", (turn,)).fetchone()[0] == 0


# ─── R4: criteria cannot change under a running turn ───────────────
def test_r4_criteria_cannot_be_edited_while_a_turn_runs(ai):
    """Safe by design, pinned here: ai_edit_spec refuses while a turn is
    queued or running in the conversation, so publication can never answer
    criteria that changed mid-run."""
    _clear_queue(ai)
    owner = ai.member("r4")
    turn, conv, _ = _submit(ai, owner)
    _claim(ai)
    rev = _revision(ai, conv)
    with pytest.raises(psycopg.errors.ObjectInUse, match="busy"):
        with ai.transaction(), ai.cursor() as cur:
            _as(cur, owner)
            cur.execute("select * from public.ai_edit_spec(%s, %s, %s::jsonb)",
                        (conv, rev,
                         json.dumps([{"op": "add", "kind": "language", "concept": "python", "required": True}])))


# ─── R6: a candidate who leaves mid-turn ────────────────────────────
@pytest.mark.parametrize("how", ["banned", "blocked", "closed_to_connections", "deleted"])
def test_r6_a_candidate_who_leaves_mid_turn_is_never_published(ai, how):
    _clear_queue(ai)
    owner = ai.member(f"r6{how}")
    turn, conv, _ = _submit(ai, owner)
    ctx = _claim(ai)
    stays, leaves = ai.candidate(f"r6s{how}"), ai.candidate(f"r6l{how}")
    _issue(ai, turn, [stays, leaves])
    if how == "banned":
        with ai.transaction():
            ai.execute("select set_config('foundry.onboarding_submission', 'true', true)")
            ai.execute("update public.profiles set status = 'rejected' where id = %s", (leaves,))
    elif how == "blocked":
        ai.execute("insert into public.connections (requester_id, addressee_id, status, blocked_by, decided_at) "
                   "values (%s, %s, 'blocked', %s, now())", (leaves, owner, leaves))
    elif how == "closed_to_connections":
        ai.execute("update public.profiles set open_to_connections = false where id = %s", (leaves,))
    else:
        ai.execute("delete from auth.users where id = %s", (leaves,))
    targets = [stays] if how == "deleted" else [stays, leaves]
    published = ai.execute(_publish_sql(), (turn, ctx["lease"], ctx["fence"], _revision(ai, conv), _results(targets))).fetchone()[0]
    assert published == 1
    got = {r[0] for r in ai.execute("select target_member from ai_private.results where turn_id = %s", (turn,))}
    assert got == {stays}


# ─── R9: confirming requirements for an older version of the job ────
def test_r9_requirements_for_an_older_job_version_cannot_be_confirmed(ai):
    """The poster's panel shows requirements parsed from the job's text;
    an approved edit changes the text. Before: confirming stamped the old
    list as the confirmed requirements of the new version."""
    poster = ai.member("r9poster", enrolled=False)
    job = ai.execute(
        """insert into public.opportunities (posted_by, status, position_name, company, pay, location_type, description,
             start_month, start_year, application_deadline, contact_email, apply_method, approved_at, approved_by,
             eligible_audience, creation_source)
           values (%s, 'approved', 'ML Intern', 'Acme', 'Paid', 'remote', 'Must know PyTorch. Python is a plus.',
             6, 2027, current_date + 30, 'jobs@acme.test', 'email', now(), %s, 'both', 'member') returning id""",
        (poster, poster)).fetchone()[0]
    version = ai.execute("select content_version from public.opportunities where id = %s", (job,)).fetchone()[0]
    ai.execute("""insert into ai_private.job_requirements (opportunity_id, content_version, status, parsed)
                  values (%s, %s, 'parsed', '[{"id": "r1", "kind": "tool", "concept": "pytorch", "required": true}]')""",
               (job, version))
    atoms = json.dumps([{"id": "r1", "required": True}])

    def confirm(expected):
        with ai.transaction(), ai.cursor() as cur:
            _as(cur, poster)
            cur.execute("select public.ai_confirm_job_requirements(%s, %s::jsonb, %s::int)", (job, atoms, expected))

    # An approved edit changes the job's text, so its version moves on.
    ai.execute("update public.opportunities set description = 'Must know TensorFlow now.' where id = %s", (job,))
    with pytest.raises(psycopg.errors.RaiseException, match="requirements_outdated"):
        confirm(version)
    with pytest.raises(psycopg.errors.RaiseException, match="requirements_outdated"):
        confirm(None)  # the stored parse is for the old text, whatever the client says
    status = ai.execute("select status from ai_private.job_requirements where opportunity_id = %s", (job,)).fetchone()[0]
    assert status == "parsed"


# ─── R10: one member's concurrent submissions ───────────────────────
def test_r10_a_burst_from_one_member_admits_at_most_two(ai):
    """Two in flight per member, serialised by the per-member admission
    lock: eight simultaneous submissions in new conversations admit two."""
    _clear_queue(ai)
    owner = ai.member("r10")
    outcomes: list[str] = []
    barrier = threading.Barrier(8)

    def go(i: int) -> None:
        with psycopg.connect(DSN) as c, c.transaction(), c.cursor() as cur:
            _as(cur, owner)
            barrier.wait()
            cur.execute("select outcome from public.ai_submit_turn('network', null, null, 'message', %s, %s, null, false)",
                        (f"python {i}", uuid.uuid4().hex))
            outcomes.append(cur.fetchone()[0])

    threads = [threading.Thread(target=go, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert outcomes.count("queued") == 2, outcomes
    assert set(outcomes) <= {"queued", "busy"}, outcomes


# ─── R11: twenty concurrent reservations against one cap ────────────
def test_r11_twenty_concurrent_reservations_never_overspend(ai):
    """§14.1: at least 20 real concurrent reservations. The ingestion cap
    is set to fit exactly ten; twenty workers reserve at once."""
    member = ai.member("r11")
    price = ai.execute("select input_micro_per_mtok, output_micro_per_mtok from ai_private.model_prices "
                       "where model = 'fake-large'").fetchone()
    one = (1000 * price[0] + 1000 * price[1]) // 1_000_000
    spent = ai.execute("select coalesce(sum(case when status = 'settled' then settled_micro else reserved_micro end), 0) "
                       "from ai_private.spend where purpose = 'ingestion' and status <> 'released' "
                       "and day = (now() at time zone 'utc')::date").fetchone()[0]
    saved = ai.execute("select ingestion_daily_cap_micro, member_daily_cap_micro from ai_private.settings where id = 1").fetchone()
    ai.execute("update ai_private.settings set ingestion_daily_cap_micro = %s, member_daily_cap_micro = %s where id = 1",
               (spent + 10 * one, 10**12))
    ok: list[uuid.UUID] = []
    refused: list[str] = []
    barrier = threading.Barrier(20)

    def go() -> None:
        with psycopg.connect(DSN, autocommit=True) as c:
            barrier.wait()
            try:
                ok.append(c.execute("select ai_private.spend_reserve('ingestion', null, %s, null, null, 'race', 'fake-large', 1000, 1000)",
                                    (member,)).fetchone()[0])
            except psycopg.errors.RaiseException as exc:
                refused.append(str(exc).splitlines()[0])

    try:
        threads = [threading.Thread(target=go) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(ok) == 10, (len(ok), refused[:3])
        assert all(r.startswith("budget_exhausted") for r in refused)
    finally:
        ai.execute("update ai_private.settings set ingestion_daily_cap_micro = %s, member_daily_cap_micro = %s where id = 1", saved)
        ai.execute("update ai_private.spend set status = 'released' where member_id = %s and stage = 'race'", (member,))


# ─── R15: double clicks ─────────────────────────────────────────────
def test_r15_saving_findings_twice_at_once_saves_once(ai):
    _clear_queue(ai)
    owner = ai.member("r15")
    turn, conv, _ = _submit(ai, owner)
    job = ai.execute(
        """insert into public.opportunities (posted_by, status, position_name, company, pay, location_type, description,
             start_month, start_year, application_deadline, contact_email, apply_method, approved_at, approved_by,
             eligible_audience, creation_source)
           values (%s, 'approved', 'Analyst', 'Acme', 'Paid', 'remote', 'Analyst role using SQL every day.',
             6, 2027, current_date + 30, 'jobs@acme.test', 'email', now(), %s, 'both', 'member') returning id""",
        (owner, owner)).fetchone()[0]
    ai.execute("update ai_private.turns set status = 'completed', mode = 'recruiter', opportunity_id = %s, "
               "lease_token = null where id = %s", (job, turn))
    first, second = hold_then_race(
        lambda cur: _one(cur, "select public.ai_save_findings(%s)", (turn,)),
        lambda cur: _one(cur, "select public.ai_save_findings(%s)", (turn,)),
        first_as=owner, second_as=owner,
    )
    assert not isinstance(second, psycopg.Error), second
    assert ai.execute("select count(*) from ai_private.saved_scans where turn_id = %s", (turn,)).fetchone()[0] == 1


# ─── Token ceiling (Appendix A) ─────────────────────────────────────
def test_the_member_token_ceiling_refuses_past_the_daily_allowance(ai):
    _clear_queue(ai)
    owner = ai.member("tokens")
    turn, conv, _ = _submit(ai, owner)
    ctx = _claim(ai)
    cap = ai.execute("select member_daily_token_cap from ai_private.settings where id = 1").fetchone()[0]
    reserve = "select ai_private.exec_reserve(%s, %s, 'interpret', 'fake-large', %s, %s)"
    ai.execute(reserve, (turn, ctx["lease"], cap - 2000, 1000)).fetchone()
    with pytest.raises(psycopg.errors.RaiseException, match="member_tokens"):
        ai.execute(reserve, (turn, ctx["lease"], 1500, 1000))
    ai.execute("update ai_private.spend set status = 'released' where turn_id = %s", (turn,))
