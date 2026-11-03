"""Whole-app concurrency (programme S0, docs/audits/D9-concurrency.md).

Every test forces the interleaving instead of hoping for it: the first
call runs inside a transaction that does its write and then stays open,
holding its row locks; the second call starts on another connection while
that transaction is open; then the first commits. Under READ COMMITTED a
check made by the second call ("is it still pending?", "is the ticket
unused?", "have I already posted this?") reads the old committed state, so
a function that checks and then writes without a lock does the wrong
thing here every time, not one run in a thousand.

Each test asserts the outcome a member or admin would care about: one
email's worth of effect, one audit row, one paid job, no edit slipping past
moderation.

Opt-in like the other integration tests (AI_INTEGRATION_DSN, local only).
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from contextlib import contextmanager

import psycopg
import pytest

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")


# ─── Plumbing ───────────────────────────────────────────────────────
def _as(cur, uid: uuid.UUID | None) -> None:
    """Make the rest of this transaction run as a signed-in member, the
    way PostgREST does."""
    if uid is None:
        return
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({"sub": str(uid), "role": "authenticated"}),))


def _waiting_on_lock(admin, pid: int) -> bool:
    row = admin.execute("select wait_event_type from pg_stat_activity where pid = %s", (pid,)).fetchone()
    return bool(row and row[0] == "Lock")


def hold_then_race(first, second, *, first_as=None, second_as=None):
    """Run `first` in an open transaction, start `second` concurrently,
    then commit `first`. Returns (first_result, second_result) where a
    raised database error is returned as the exception instance."""
    admin = psycopg.connect(DSN, autocommit=True)
    c1 = psycopg.connect(DSN)
    c2 = psycopg.connect(DSN)
    out: dict = {}
    try:
        with c1.cursor() as cur:
            _as(cur, first_as)
            out["first"] = first(cur)

        def run_second() -> None:
            try:
                with c2.transaction(), c2.cursor() as cur:
                    _as(cur, second_as)
                    out["second"] = second(cur)
            except psycopg.Error as exc:
                out["second"] = exc

        t = threading.Thread(target=run_second)
        t.start()
        pid = c2.info.backend_pid
        deadline = time.monotonic() + 3
        while t.is_alive() and time.monotonic() < deadline and not _waiting_on_lock(admin, pid):
            time.sleep(0.02)
        c1.commit()
        t.join(10)
        assert not t.is_alive(), "second call never finished"
        return out["first"], out["second"]
    finally:
        for c in (c1, c2, admin):
            c.close()


def _one(cur, sql: str, params: tuple = ()):
    cur.execute(sql, params)
    return cur.fetchone() if cur.description else None


# ─── World ──────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def db():
    conn = psycopg.connect(DSN, autocommit=True)
    created: list[uuid.UUID] = []
    tag = uuid.uuid4().hex[:6]

    def member(name: str, *, role: str = "student", status: str = "approved", admin: bool = False) -> uuid.UUID:
        uid = uuid.uuid4()
        conn.execute(
            """insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token,
                 recovery_token, email_change_token_new, email_change, aud, role)
               values (%s, %s, %s, '{"provider":"email"}', '', '', '', '', 'authenticated', 'authenticated')""",
            (uid, f"cc-{name}-{tag}@imperial.ac.uk",
             json.dumps({"first_name": "Cc", "surname": name.title(), "role": role,
                         "grad_year": 2028 if role == "student" else 2020})),
        )
        with conn.transaction():
            conn.execute("select set_config('foundry.onboarding_submission', 'true', true)")
            conn.execute("update public.profiles set status = %s, course = 'Computing', "
                         "linkedin_url = 'https://www.linkedin.com/in/cc' where id = %s", (status, uid))
        conn.execute("insert into public.member_education (member_id, currently_enrolled, has_completed_degree) "
                     "values (%s, true, false) on conflict do nothing", (uid,))
        if admin:
            conn.execute("insert into public.admins (user_id) values (%s)", (uid,))
        created.append(uid)
        return uid

    conn.member = member  # type: ignore[attr-defined]
    yield conn
    for uid in created:
        for table in ("opportunities", "events", "vcs_grants"):
            conn.execute(f"delete from public.{table} where approved_by = %s", (uid,))
        conn.execute("delete from public.opportunities where posted_by = %s", (uid,))
        conn.execute("delete from public.events where posted_by = %s", (uid,))
        conn.execute("delete from public.vcs_grants where posted_by = %s", (uid,))
        conn.execute("delete from public.jobs where payload->>'member_id' = %s or payload->>'cv_id' in "
                     "(select id::text from public.cvs where member_id = %s)", (str(uid), uid))
        conn.execute("delete from auth.users where id = %s", (uid,))
    # Deleting a GitHub connection queues a token revocation; these test
    # connections (github_user_id 777xxxxxx) have no real token to revoke.
    conn.execute("delete from public.jobs where kind = 'revoke_github_token' "
                 "and (payload->>'github_user_id')::bigint between 777000000 and 777999999")
    conn.close()


@pytest.fixture(scope="module")
def admins(db):
    return db.member("admina", admin=True), db.member("adminb", admin=True)


def _pending_event(db, owner) -> uuid.UUID:
    return db.execute(
        """insert into public.events (posted_by, title, description, luma_link, event_at, location,
             organiser_name, contact_email)
           values (%s, 'Demo night', 'Founders demo their products.', 'https://lu.ma/x', now() + interval '9 days',
             'Huxley', 'ICF', 'e@imperial.ac.uk') returning id""", (owner,)).fetchone()[0]


def _pending_opportunity(db, owner) -> uuid.UUID:
    return db.execute(
        """insert into public.opportunities (posted_by, status, position_name, company, pay, location_type,
             description, start_month, start_year, application_deadline, contact_email, apply_method,
             eligible_audience, creation_source)
           values (%s, 'pending', 'Original title', 'Acme', 'Paid', 'remote', 'Original description of the role.',
             6, 2027, current_date + 30, 'jobs@acme.test', 'email', 'both', 'member') returning id""",
        (owner,)).fetchone()[0]


def _pending_vc(db, owner) -> uuid.UUID:
    return db.execute(
        """insert into public.vcs_grants (kind, posted_by, name, description, link)
           values ('vc', %s, 'Seed fund', 'Backs student founders.', 'https://vc.test') returning id""",
        (owner,)).fetchone()[0]


def _audit_count(db, target) -> int:
    return db.execute("select count(*) from public.admin_actions where target_id = %s", (target,)).fetchone()[0]


# ─── Moderation decisions ───────────────────────────────────────────
@pytest.mark.parametrize("kind", ["event", "opportunity", "vc_grant"])
def test_approve_and_reject_of_one_listing_cannot_both_succeed(db, admins, kind):
    """Two admins deciding the same listing at once. Before: both calls
    succeeded, the poster was emailed 'rejected' after 'approved', and the
    final state was whichever committed last."""
    a, b = admins
    owner = db.member(f"poster{kind}")
    make, approve, reject, table = {
        "event": (_pending_event, "approve_event", "reject_event", "events"),
        "opportunity": (_pending_opportunity, "approve_opportunity", "reject_opportunity", "opportunities"),
        "vc_grant": (_pending_vc, "approve_vc_grant", "reject_vc_grant", "vcs_grants"),
    }[kind]
    listing = make(db, owner)
    # approve_* refuses a null expected version since b87df86 (the TOCTOU pin).
    version = db.execute(f"select edit_version from public.{table} where id = %s", (listing,)).fetchone()[0]
    first, second = hold_then_race(
        lambda cur: _one(cur, f"select public.{approve}(%s, null, %s)", (listing, version)),
        lambda cur: _one(cur, f"select * from public.{reject}(%s, 'Spam')", (listing,)),
        first_as=a, second_as=b,
    )
    assert isinstance(second, psycopg.Error), "the second decision must be refused, not applied on top"
    status = db.execute(f"select status from public.{table} where id = %s", (listing,)).fetchone()[0]
    assert status == "approved"
    assert _audit_count(db, listing) == 1


def test_approve_and_reject_of_one_member_cannot_both_succeed(db, admins):
    a, b = admins
    applicant = db.member("applicant", role="alum", status="pending_review")
    first, second = hold_then_race(
        lambda cur: _one(cur, "select * from public.approve_user(%s, null)", (applicant,)),
        lambda cur: _one(cur, "select * from public.reject_user(%s, 'No')", (applicant,)),
        first_as=a, second_as=b,
    )
    assert isinstance(second, psycopg.Error), "an approved member must not then be deleted as rejected"
    assert db.execute("select status from public.profiles where id = %s", (applicant,)).fetchone()[0] == "approved"
    assert _audit_count(db, applicant) == 1


def test_a_post_report_is_resolved_once(db, admins):
    a, b = admins
    author, reporter = db.member("rauthor"), db.member("reporter")
    post = db.execute("insert into public.posts (author_id, title, body) values (%s, 'A title', 'A body') returning id",
                      (author,)).fetchone()[0]
    report = db.execute(
        "insert into public.post_reports (post_id, post_title_snapshot, reporter_id, category, reason) "
        "values (%s, 'A title', %s, 'spam', 'spam') returning id", (post, reporter)).fetchone()[0]
    _, second = hold_then_race(
        lambda cur: _one(cur, "select * from public.admin_resolve_post_report(%s, 'actioned', null)", (report,)),
        lambda cur: _one(cur, "select * from public.admin_resolve_post_report(%s, 'dismissed', null)", (report,)),
        first_as=a, second_as=b,
    )
    assert isinstance(second, psycopg.Error)
    assert db.execute("select status from public.post_reports where id = %s", (report,)).fetchone()[0] == "actioned"
    assert _audit_count(db, report) == 1


def test_a_post_is_removed_once(db, admins):
    """Before: two admins removing one post wrote two moderation-log rows
    and emailed the author twice."""
    a, b = admins
    author = db.member("dauthor")
    post = db.execute("insert into public.posts (author_id, title, body) values (%s, 'A title', 'A body') returning id",
                      (author,)).fetchone()[0]
    _, second = hold_then_race(
        lambda cur: _one(cur, "select * from public.admin_delete_post(%s, 'Spam')", (post,)),
        lambda cur: _one(cur, "select * from public.admin_delete_post(%s, 'Spam')", (post,)),
        first_as=a, second_as=b,
    )
    assert isinstance(second, psycopg.Error)
    assert db.execute("select count(*) from public.post_moderation_log where post_id = %s", (post,)).fetchone()[0] == 1


def test_an_account_is_deleted_once(db, admins):
    a, b = admins
    target = db.member("doomed")
    _, second = hold_then_race(
        lambda cur: _one(cur, "select * from public.admin_delete_user(%s, 'Requested')", (target,)),
        lambda cur: _one(cur, "select * from public.admin_delete_user(%s, 'Requested')", (target,)),
        first_as=a, second_as=b,
    )
    assert isinstance(second, psycopg.Error), "the second delete must not report (and email) a deletion"
    assert db.execute("select count(*) from public.admin_actions where target_id = %s and action = 'admin_delete_user'",
                      (target,)).fetchone()[0] == 1


# ─── Member writes ──────────────────────────────────────────────────
def test_an_upload_ticket_is_consumed_once(db):
    """Before: a double-submitted CV confirm created two cvs rows and two
    paid ingestion jobs from one ticket."""
    m = db.member("uploader")
    key = f"{uuid.uuid4()}.cv"
    db.execute("insert into public.upload_tickets (blob_key, user_id, purpose) values (%s, %s, 'cv')", (key, m))
    _, second = hold_then_race(
        lambda cur: _one(cur, "select public.confirm_cv_upload(%s, 'cv.pdf', true)", (key,)),
        lambda cur: _one(cur, "select public.confirm_cv_upload(%s, 'cv.pdf', true)", (key,)),
        first_as=m, second_as=m,
    )
    assert isinstance(second, psycopg.Error)
    assert db.execute("select count(*) from public.cvs where blob_key = %s", (key,)).fetchone()[0] == 1
    assert db.execute("select count(*) from public.jobs where kind = 'ingest_cv' and payload->>'cv_id' in "
                      "(select id::text from public.cvs where blob_key = %s)", (key,)).fetchone()[0] == 1


def test_an_avatar_ticket_is_consumed_once(db):
    m = db.member("avatar")
    key = f"{uuid.uuid4()}.webp"
    db.execute("insert into public.upload_tickets (blob_key, user_id, purpose) values (%s, %s, 'profile_picture')",
               (key, m))
    _, second = hold_then_race(
        lambda cur: _one(cur, "select public.confirm_avatar_upload(%s)", (key,)),
        lambda cur: _one(cur, "select public.confirm_avatar_upload(%s)", (key,)),
        first_as=m, second_as=m,
    )
    assert isinstance(second, psycopg.Error)


def test_a_double_submitted_post_is_posted_once(db):
    """The duplicate check exists for exactly this (a double click on a
    slow connection) and missed it whenever the two requests overlapped."""
    row = db.execute("select value from public.app_config where key='community_posts_enabled'").fetchone()
    saved = row[0] if row else None
    db.execute(
        "insert into public.app_config (key, value) values ('community_posts_enabled', 'true') "
        "on conflict (key) do update set value = 'true'"
    )
    try:
        m = db.member("poster")
        title = f"Hello {uuid.uuid4().hex[:6]}"
        _, second = hold_then_race(
            lambda cur: _one(cur, "select id from public.create_post(%s, 'Body text', '[]'::jsonb)", (title,)),
            lambda cur: _one(cur, "select id from public.create_post(%s, 'Body text', '[]'::jsonb)", (title,)),
            first_as=m, second_as=m,
        )
        assert isinstance(second, psycopg.Error)
        assert db.execute("select count(*) from public.posts where author_id = %s and title = %s",
                          (m, title)).fetchone()[0] == 1
    finally:
        if saved is None:
            db.execute("delete from public.app_config where key='community_posts_enabled'")
        else:
            db.execute("update public.app_config set value=%s where key='community_posts_enabled'", (saved,))


def test_concurrent_like_toggles_never_error(db):
    """Two taps from one member on a slow connection. Before: the second
    failed with a raw unique violation. After: the toggles serialise, so
    two taps are like then unlike."""
    author, fan = db.member("likeauthor"), db.member("fan")
    post = db.execute("insert into public.posts (author_id, title, body) values (%s, 'A title', 'A body') returning id",
                      (author,)).fetchone()[0]
    first, second = hold_then_race(
        lambda cur: _one(cur, "select liked from public.toggle_post_like(%s)", (post,)),
        lambda cur: _one(cur, "select liked from public.toggle_post_like(%s)", (post,)),
        first_as=fan, second_as=fan,
    )
    assert not isinstance(second, psycopg.Error), second
    assert (first[0], second[0]) == (True, False)
    assert db.execute("select count(*) from public.post_likes where post_id = %s", (post,)).fetchone()[0] == 0


@pytest.mark.parametrize("kind", ["opportunity", "event", "vc_grant"])
def test_an_edit_racing_approval_goes_through_review(db, admins, kind):
    """A member edits a pending listing at the moment an admin approves it.
    Before: the edit read 'pending', then wrote straight onto the
    now-approved listing — live, unreviewed content. After: it waits for
    the approval and is staged as a pending edit instead."""
    a, _ = admins
    owner = db.member(f"editor{kind}")
    if kind == "opportunity":
        listing = _pending_opportunity(db, owner)
        approve = ("select public.approve_opportunity(%s, null, %s)", (listing, None))
        edit = ("""select public.update_opportunity(%s, 'Edited title', 'Acme', 'Paid', 'remote', null,
                     'Edited description of the role.', 6::smallint, 2027, current_date + 30, 'jobs@acme.test', false,
                     'email', null, '{}'::smallint[], '{}'::smallint[], 'both')""", (listing,))
        table, column, original = "opportunities", "position_name", "Original title"
    elif kind == "event":
        listing = _pending_event(db, owner)
        approve = ("select public.approve_event(%s, null, %s)", (listing, None))
        edit = ("""select public.update_event(%s, 'Edited title', 'Edited description of the event for members.', 'https://lu.ma/x',
                     now() + interval '9 days', 'Huxley', 'ICF', 'e@imperial.ac.uk', false)""", (listing,))
        table, column, original = "events", "title", "Demo night"
    else:
        listing = _pending_vc(db, owner)
        approve = ("select public.approve_vc_grant(%s, null, %s)", (listing, None))
        edit = ("""select public.update_vc_grant(%s, 'vc', 'Edited title', 'Edited description of the fund for founders.', 'https://vc.test',
                     null, null, null)""", (listing,))
        table, column, original = "vcs_grants", "name", "Seed fund"
    version = db.execute(f"select edit_version from public.{table} where id=%s", (listing,)).fetchone()[0]
    approve = (approve[0], (listing, version))
    edit = (edit[0][:-1] + f", p_expected_version => {version})", edit[1])
    _, second = hold_then_race(
        lambda cur: _one(cur, *approve),
        lambda cur: _one(cur, *edit),
        first_as=a, second_as=owner,
    )
    assert not isinstance(second, psycopg.Error), second
    live = db.execute(f"select {column} from public.{table} where id = %s", (listing,)).fetchone()[0]
    assert live == original, "an unreviewed edit reached an approved listing"
    staged = db.execute("select count(*) from public.listing_edits where listing_id = %s and status = 'pending'",
                        (listing,)).fetchone()[0]
    assert staged == 1


# ─── Background job enqueues ────────────────────────────────────────
def test_job_enqueue_dedupe_holds_under_concurrency(db):
    """refresh_* jobs are enqueued 'unless one is already pending'. Two
    overlapping enqueues both saw none and queued two paid jobs."""
    m = db.member("jobs")
    enqueue = ("insert into public.jobs (kind, payload) select 'refresh_github_summary', "
               "jsonb_build_object('member_id', %s::text) where not exists (select 1 from public.jobs j "
               "where j.kind = 'refresh_github_summary' and j.status = 'pending' and j.payload->>'member_id' = %s::text) "
               "on conflict do nothing")
    hold_then_race(
        lambda cur: _one(cur, enqueue, (str(m), str(m))),
        lambda cur: _one(cur, enqueue, (str(m), str(m))),
    )
    assert db.execute("select count(*) from public.jobs where kind = 'refresh_github_summary' and status = 'pending' "
                      "and payload->>'member_id' = %s", (str(m),)).fetchone()[0] == 1


def test_ai_refresh_enqueue_dedupe_holds_under_concurrency(db):
    m = db.member("aijobs")
    saved = db.execute("select value from public.app_config where key = 'ai_enabled'").fetchone()[0]
    db.execute("update public.app_config set value = 'true' where key = 'ai_enabled'")
    try:
        hold_then_race(
            lambda cur: _one(cur, "select ai_private.bump_member_source(%s)", (m,)),
            lambda cur: _one(cur, "select ai_private.bump_member_source(%s)", (m,)),
        )
        assert db.execute("select count(*) from public.jobs where kind = 'refresh_member_ai' and status = 'pending' "
                          "and payload->>'member_id' = %s", (str(m),)).fetchone()[0] == 1
    finally:
        db.execute("update public.app_config set value = %s where key = 'ai_enabled'", (saved,))


# ─── Service logins fail fast instead of hanging (gap 37) ───────────
def test_a_blocked_executor_call_times_out_instead_of_hanging(db):
    """lock_timeout on ai_service: a claim stuck behind a held lock gives
    up in about three seconds, so a stuck transaction elsewhere cannot hold
    an executor worker (and its pooler slot) forever."""
    params = psycopg.conninfo.conninfo_to_dict(DSN)
    params.update(user="ai_service", password="ai_service-local", sslmode="disable")
    db.execute("alter role ai_service password 'ai_service-local'")
    holder = psycopg.connect(DSN)
    try:
        holder.execute("select pg_advisory_xact_lock(hashtext('ai_claim'))")  # held until rollback
        with psycopg.connect(psycopg.conninfo.make_conninfo(**params), autocommit=True) as svc:
            started = time.monotonic()
            with pytest.raises(psycopg.errors.LockNotAvailable):
                svc.execute("select ai_private.exec_claim('timeout-test')")
            assert time.monotonic() - started < 6
    finally:
        holder.rollback()
        holder.close()


# ─── Scheduled jobs: two overlapping runs (gap 38) ──────────────────
def _due_nudge_member(db, name: str) -> uuid.UUID:
    m = db.member(name)
    db.execute(
        """insert into public.github_connections (member_id, github_user_id, github_username, access_token_encrypted,
             scan_status, last_scanned_at, available_repos, showcase_seen_repos)
           values (%s, %s, %s, 'x', 'ready', now() - interval '1 day', '[{"name": "new-repo"}]'::jsonb, '{}')""",
        (m, 777_000_000 + abs(hash(name)) % 1_000_000, f"gh-{name}"))
    return m


def test_overlapping_nudge_runs_claim_disjoint_members(db):
    ours = {_due_nudge_member(db, f"nudge{i}") for i in range(3)}
    first, second = hold_then_race(
        lambda cur: (cur.execute("select member_id from public.due_github_showcase_nudges(500)"), cur.fetchall())[1],
        lambda cur: (cur.execute("select member_id from public.due_github_showcase_nudges(500)"), cur.fetchall())[1],
    )
    got1 = {r[0] for r in first} & ours
    got2 = {r[0] for r in second} & ours
    assert got1 == ours
    assert not (got1 & got2), "two overlapping runs would email the same members twice"


def test_overlapping_ticket_purges_queue_each_blob_once(db):
    m = db.member("ticketpurge")
    keys = [f"{uuid.uuid4()}.webp" for _ in range(3)]
    for k in keys:
        db.execute("insert into public.upload_tickets (blob_key, user_id, purpose, issued_at) "
                   "values (%s, %s, 'post_image', now() - interval '2 days')", (k, m))
    hold_then_race(
        lambda cur: _one(cur, "select public.purge_stale_upload_tickets()"),
        lambda cur: _one(cur, "select public.purge_stale_upload_tickets()"),
    )
    queued = db.execute("select count(*) from public.blob_deletion_queue where blob_key = any(%s)", (keys,)).fetchone()[0]
    db.execute("delete from public.blob_deletion_queue where blob_key = any(%s)", (keys,))
    assert queued == 3, f"{queued} queue rows for 3 abandoned uploads"


def test_overlapping_expiry_runs_expire_each_listing_once(db):
    owner = db.member("expirer")
    opp = db.execute(
        """insert into public.opportunities (posted_by, status, position_name, company, pay, location_type,
             description, start_month, start_year, application_deadline, contact_email, apply_method,
             approved_at, eligible_audience, creation_source)
           values (%s, 'approved', 'Old role', 'Acme', 'Paid', 'remote', 'A role whose deadline has passed.',
             6, 2027, current_date - 1, 'jobs@acme.test', 'email', now(), 'both', 'member') returning id""",
        (owner,)).fetchone()[0]
    first, second = hold_then_race(
        lambda cur: _one(cur, "select public.expire_opportunities()"),
        lambda cur: _one(cur, "select public.expire_opportunities()"),
    )
    assert not isinstance(second, psycopg.Error), second
    assert db.execute("select status from public.opportunities where id = %s", (opp,)).fetchone()[0] == "expired"
    assert first[0] >= 1 and second[0] == 0 or first[0] == 0, (first, second)


@pytest.mark.parametrize("call", [
    "select ai_private.cron_purge()", "select ai_private.cron_reap()",
    "select public.enqueue_github_rescans()", "select public.expire_connection_requests()",
    "select public.expire_events()", "select public.expire_vcs_grants()",
    "select public.purge_removed_connections()", "select public.purge_connection_records()",
    "select public.purge_expired_posts()", "select public.purge_moderation_records()",
    "select public.purge_old_notifications()", "select public.purge_sent_outbound_email()",
    "select public.purge_rejected_listings()", "select public.reap_stalled_jobs()",
])
def test_every_scheduled_sql_job_tolerates_an_overlapping_run(db, call):
    """pg_cron does not guarantee a run has finished before the next is
    due, and an operator can run one by hand. Two at once must both
    finish without error (the outcome checks are in the tests above)."""
    first, second = hold_then_race(lambda cur: _one(cur, call), lambda cur: _one(cur, call))
    assert not isinstance(second, psycopg.Error), second


# ─── Per-member caps and privileged flags (concurrency audit) ───────
def test_the_outstanding_ticket_cap_holds_under_a_parallel_burst(db):
    """The 60-ticket ceiling counted open tickets and then inserted, with no lock: two overlapping calls both
    saw 59 and both issued, so a burst walked straight past the cap."""
    m = db.member("ticketcap")
    for _ in range(59):
        db.execute("insert into public.upload_tickets (blob_key, user_id, purpose) values (%s, %s, 'cv')",
                   (f"{uuid.uuid4()}.cv", m))
    _, second = hold_then_race(
        lambda cur: _one(cur, "select public.issue_upload_ticket('cv')"),
        lambda cur: _one(cur, "select public.issue_upload_ticket('cv')"),
        first_as=m, second_as=m,
    )
    assert isinstance(second, psycopg.Error), "the second ticket was issued past the cap"
    assert db.execute("select count(*) from public.upload_tickets where user_id = %s and consumed_at is null",
                      (m,)).fetchone()[0] == 60


def test_the_daily_post_report_cap_holds_under_a_parallel_burst(db):
    author, reporter = db.member("rpauthor"), db.member("rpreporter")
    posts = [db.execute("insert into public.posts (author_id, title, body) values (%s, 'A title', 'A body') "
                        "returning id", (author,)).fetchone()[0] for _ in range(11)]
    for p in posts[:9]:
        db.execute("insert into public.post_reports (post_id, post_title_snapshot, reporter_id, category, reason) "
                   "values (%s, 'A title', %s, 'spam', 'spam')", (p, reporter))
    _, second = hold_then_race(
        lambda cur: _one(cur, "select * from public.report_post(%s, 'spam', 'spam')", (posts[9],)),
        lambda cur: _one(cur, "select * from public.report_post(%s, 'spam', 'spam')", (posts[10],)),
        first_as=reporter, second_as=reporter,
    )
    assert isinstance(second, psycopg.Error), "an eleventh report was filed in one day"
    assert db.execute("select count(*) from public.post_reports where reporter_id = %s", (reporter,)).fetchone()[0] == 10


def test_the_daily_connection_report_cap_holds_under_a_parallel_burst(db):
    reporter = db.member("rcreporter2")
    conns = []
    for i in range(11):
        other = db.member(f"rcother{i}")
        conns.append((db.execute("insert into public.connections (requester_id, addressee_id) values (%s, %s) "
                                 "returning id", (reporter, other)).fetchone()[0], other))
    for cid, other in conns[:9]:
        db.execute("insert into public.connection_reports (connection_id, reporter_id, reported_member_id, category, reason) "
                   "values (%s, %s, %s, 'spam', 'spam')", (cid, reporter, other))
    _, second = hold_then_race(
        lambda cur: _one(cur, "select * from public.report_connection(%s, 'spam', 'spam')", (conns[9][0],)),
        lambda cur: _one(cur, "select * from public.report_connection(%s, 'spam', 'spam')", (conns[10][0],)),
        first_as=reporter, second_as=reporter,
    )
    assert isinstance(second, psycopg.Error), "an eleventh report was filed in one day"
    assert db.execute("select count(*) from public.connection_reports where reporter_id = %s",
                      (reporter,)).fetchone()[0] == 10


def test_two_admins_changing_one_committee_flag_leave_it_consistent(db, admins):
    """admin_set_committee read the old flag without a lock, so a grant and a revoke at once could leave a
    member holding admin rights with the committee flag off."""
    a, b = admins
    target = db.member("committee")
    hold_then_race(
        lambda cur: _one(cur, "select public.admin_set_committee(%s, true, 'Treasurer')", (target,)),
        lambda cur: _one(cur, "select public.admin_set_committee(%s, false, null)", (target,)),
        first_as=a, second_as=b,
    )
    flag = db.execute("select is_committee from public.profiles where id = %s", (target,)).fetchone()[0]
    has_admin = db.execute("select exists (select 1 from public.admins where user_id = %s)", (target,)).fetchone()[0]
    assert flag == has_admin, f"is_committee={flag} but admin row present={has_admin}"


def test_a_cv_publish_in_progress_makes_remove_wait_and_then_wipe_it(db):
    """The worker takes the member's CV lock before it publishes; remove_my_cv takes the same lock. Whichever
    comes first, the end state is the same: nothing of the removed CV remains."""
    uid = db.member("lockorder", role="alum")
    key = f"{uuid.uuid4()}.cv"
    cv_id = db.execute("insert into public.cvs (member_id, blob_key) values (%s, %s) returning id", (uid, key)).fetchone()[0]
    with db.transaction():
        db.execute("select set_config('foundry.media_write', 'true', true)")
        db.execute("update public.profiles set cv_path = %s where id = %s", (key, uid))

    def publish(cur):
        wanted = _one(cur, "select public.worker_cv_wanted(%s)", (cv_id,))[0]
        cur.execute("insert into public.member_skills (member_id, raw_text, confidence, source) "
                    "values (%s, 'Python', 0.9, 'cv')", (uid,))
        cur.execute("select public.update_cv_currency(%s)", (cv_id,))
        return wanted

    wanted, second = hold_then_race(publish, lambda cur: _one(cur, "select public.remove_my_cv()"), second_as=uid)
    assert wanted is True
    assert not isinstance(second, psycopg.Error), second
    assert db.execute("select count(*) from public.member_skills where member_id = %s and source = 'cv'",
                      (uid,)).fetchone()[0] == 0
    assert db.execute("select count(*) from public.cvs where member_id = %s and is_current", (uid,)).fetchone()[0] == 0
    assert db.execute("select public.worker_cv_wanted(%s)", (cv_id,)).fetchone()[0] is False


def test_a_double_submitted_intake_ends_completed_once_without_a_raw_error(db):
    """Probe: submit_intake checks `profile_version >= 2` without a lock, so two overlapping calls both pass
    it. Both apply the member's own answers, so the end state must be the same as one call: version 2, one
    completion time, and nothing but the friendly refusal (if anything) reaching the second caller."""
    uid = db.member("intake", role="alum")
    sql = ("select public.submit_intake('Dee', 'Building a thing for founders', 'Climbing and chess')")
    _, second = hold_then_race(lambda cur: _one(cur, sql), lambda cur: _one(cur, sql), first_as=uid, second_as=uid)
    if isinstance(second, psycopg.Error):
        assert "already completed" in str(second), second
    version, completed = db.execute("select profile_version, intake_completed_at from public.profiles where id = %s",
                                    (uid,)).fetchone()
    assert version == 2 and completed is not None


# ─── Second pass (D10 addendum) ─────────────────────────────────────
def _queued(db, keys):
    return dict(db.execute("select blob_key, container from public.blob_deletion_queue where blob_key = any(%s)",
                           (list(keys),)).fetchall())


def test_a_stale_upload_ticket_queues_its_blob_in_the_container_its_purpose_names(db):
    """Before: every purged ticket's blob was queued against the post-images default, so an orphaned CV was
    rejected by the gateway and an orphaned avatar 404'd (counted as deleted): neither was ever removed."""
    m = db.member("ticketorphan")
    keys = {"cv": f"{uuid.uuid4()}.cv", "profile_picture": f"{uuid.uuid4()}.webp", "post_image": f"{uuid.uuid4()}.webp"}
    try:
        for purpose, key in keys.items():
            db.execute("insert into public.upload_tickets (blob_key, user_id, purpose, issued_at) "
                       "values (%s, %s, %s, now() - interval '2 days')", (key, m, purpose))
        db.execute("select public.purge_stale_upload_tickets()")
        assert _queued(db, keys.values()) == {
            keys["cv"]: "member-cvs", keys["profile_picture"]: "profile-pictures", keys["post_image"]: "post-images"}
    finally:
        db.execute("delete from public.blob_deletion_queue where blob_key = any(%s)", (list(keys.values()),))


def test_deleting_an_account_queues_the_blobs_of_its_unconsumed_tickets(db):
    """The tickets vanish with the account (cascade) and, before, nothing queued the file they were for."""
    m = db.member("ticketowner")
    key = f"{uuid.uuid4()}.cv"
    consumed = f"{uuid.uuid4()}.cv"
    try:
        db.execute("insert into public.upload_tickets (blob_key, user_id, purpose) values (%s, %s, 'cv')", (key, m))
        db.execute("insert into public.upload_tickets (blob_key, user_id, purpose, consumed_at) values (%s, %s, 'cv', now())",
                   (consumed, m))
        db.execute("delete from auth.users where id = %s", (m,))
        assert _queued(db, [key, consumed]) == {key: "member-cvs"}, "only the unconsumed ticket's blob is orphaned"
    finally:
        db.execute("delete from public.blob_deletion_queue where blob_key = any(%s)", ([key, consumed],))


def _ban(db, uid) -> None:
    """status = 'rejected', the way the ban procedure leaves a member (the status guard needs the lifecycle flag)."""
    with db.transaction():
        db.execute("select set_config('foundry.onboarding_submission', 'true', true)")
        db.execute("update public.profiles set status = 'rejected' where id = %s", (uid,))


def test_a_banned_members_email_does_not_get_instant_approval_after_they_delete_and_return(db):
    """Before: delete_my_account removed every trace of a ban, and a student address was auto-approved on re-signup."""
    tag = uuid.uuid4().hex[:8]
    email = f"banned-{tag}@imperial.ac.uk"

    def signup() -> uuid.UUID:
        uid = uuid.uuid4()
        db.execute(
            """insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token,
                 recovery_token, email_change_token_new, email_change, aud, role)
               values (%s, %s, '{"first_name":"B","surname":"Anned","role":"student"}', '{"provider":"email"}',
                 '', '', '', '', 'authenticated', 'authenticated')""", (uid, email))
        return uid

    def onboard(uid) -> str:
        with psycopg.connect(DSN) as c, c.cursor() as cur:
            _as(cur, uid)
            cur.execute("select public.submit_onboarding('Computing', %s, null, null, null)", (2030,))
        return db.execute("select status::text from public.profiles where id = %s", (uid,)).fetchone()[0]

    first = signup()
    try:
        assert onboard(first) == "approved", "control: a first sign-up is approved"
        _ban(db, first)                                                                         # the ban
        db.execute("delete from auth.users where id = %s", (first,))                            # and the escape
        second = signup()
        assert onboard(second) == "pending_review", "a banned address was approved instantly"
    finally:
        db.execute("delete from auth.users where email = %s", (email,))
        db.execute("delete from public.banned_email_hashes where email_hash = public.email_ban_hash(%s)", (email,))


def test_deleting_an_account_that_was_not_banned_leaves_no_ban_behind(db):
    tag = uuid.uuid4().hex[:8]
    email = f"leaver-{tag}@imperial.ac.uk"
    uid = uuid.uuid4()
    db.execute(
        """insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token,
             recovery_token, email_change_token_new, email_change, aud, role)
           values (%s, %s, '{"first_name":"L","surname":"Eaver","role":"student"}', '{"provider":"email"}',
             '', '', '', '', 'authenticated', 'authenticated')""", (uid, email))
    db.execute("delete from auth.users where id = %s", (uid,))
    assert db.execute("select count(*) from public.banned_email_hashes where email_hash = public.email_ban_hash(%s)",
                      (email,)).fetchone()[0] == 0


def test_a_post_cannot_land_after_the_authors_ban(db):
    """create_post checked approval once, before its lock. A ban purges the author's posts when it commits, so a
    post that slipped in between the check and the insert survived the purge."""
    saved = db.execute("select value from public.app_config where key='community_posts_enabled'").fetchone()
    db.execute("insert into public.app_config (key, value) values ('community_posts_enabled', 'true') "
               "on conflict (key) do update set value = 'true'")
    try:
        m = db.member("bannedposter")
        _, second = hold_then_race(
            lambda cur: (cur.execute("select set_config('foundry.onboarding_submission', 'true', true)"),
                         _one(cur, "update public.profiles set status = 'rejected' where id = %s", (m,))),
            lambda cur: _one(cur, "select * from public.create_post('A title', 'A body')"),
            second_as=m,
        )
        assert isinstance(second, psycopg.Error), "a banned member's post was accepted"
        assert db.execute("select count(*) from public.posts where author_id = %s", (m,)).fetchone()[0] == 0
    finally:
        if saved:
            db.execute("update public.app_config set value = %s where key = 'community_posts_enabled'", (saved[0],))


def test_the_core_skill_cap_holds_under_parallel_direct_inserts(db):
    m = db.member("coreskills")
    ids = [r[0] for r in db.execute("select id from public.skills order by id limit 6").fetchall()]
    for sid in ids[:2]:
        db.execute("insert into public.profile_skills (profile_id, skill_id, is_core) values (%s, %s, true)", (m, sid))
    _, second = hold_then_race(
        lambda cur: _one(cur, "insert into public.profile_skills (profile_id, skill_id, is_core) values (%s, %s, true)", (m, ids[2])),
        lambda cur: _one(cur, "insert into public.profile_skills (profile_id, skill_id, is_core) values (%s, %s, true)", (m, ids[3])),
    )
    assert isinstance(second, psycopg.Error), "a fourth core skill was accepted"
    assert db.execute("select count(*) from public.profile_skills where profile_id = %s and is_core", (m,)).fetchone()[0] == 3


def test_the_opportunity_skill_cap_holds_under_parallel_statements(db):
    """Pinned, not fixed: this already held. The row-level edit-version trigger bumps the parent opportunity (a row
    lock) before the statement-level cap trigger counts, so the second writer waits and then sees the first's rows.
    If that trigger ever changes, this is what notices."""
    owner = db.member("skillsowner")
    opp = _pending_opportunity(db, owner)
    ids = [r[0] for r in db.execute("select id from public.skills order by id limit 52").fetchall()]
    sql = "insert into public.opportunity_skills (opportunity_id, skill_id) select %s, unnest(%s::smallint[])"
    _, second = hold_then_race(
        lambda cur: _one(cur, sql, (opp, ids[:26])),
        lambda cur: _one(cur, sql, (opp, ids[26:])),
    )
    assert isinstance(second, psycopg.Error), "an opportunity ended up with more than 50 skills"
    assert db.execute("select count(*) from public.opportunity_skills where opportunity_id = %s", (opp,)).fetchone()[0] <= 50


def test_a_member_cannot_hold_more_than_twenty_draft_handoffs(db):
    m = db.member("handoffs")
    for _ in range(20):
        with psycopg.connect(DSN) as c, c.cursor() as cur:
            _as(cur, m)
            cur.execute("select public.ai_create_draft_handoff('network', '{}'::jsonb)")
    with pytest.raises(psycopg.Error, match="too_many_handoffs"):
        with psycopg.connect(DSN) as c, c.cursor() as cur:
            _as(cur, m)
            cur.execute("select public.ai_create_draft_handoff('network', '{}'::jsonb)")
    db.execute("delete from ai_private.draft_handoffs where owner_id = %s", (m,))


def _direct_update(uid, sql, params):
    """A PostgREST-style direct UPDATE as the member; returns the number of rows changed or the error."""
    try:
        with psycopg.connect(DSN) as c, c.cursor() as cur:
            _as(cur, uid)
            cur.execute(sql, params)
            return cur.rowcount
    except psycopg.Error as exc:
        return exc


def test_a_member_cannot_move_their_listing_into_the_past_with_a_direct_update(db):
    owner = db.member("pastdates")
    event, opp = _pending_event(db, owner), _pending_opportunity(db, owner)
    future_event = "update public.events set event_at = now() + interval '20 days' where id = %s"
    past_event = "update public.events set event_at = now() - interval '3 days' where id = %s"
    future_opp = "update public.opportunities set application_deadline = current_date + 40 where id = %s"
    past_opp = "update public.opportunities set application_deadline = current_date - 3 where id = %s"
    assert _direct_update(owner, future_event, (event,)) == 1, "control: a future date is allowed (so RLS is not what refused)"
    assert _direct_update(owner, future_opp, (opp,)) == 1
    assert isinstance(_direct_update(owner, past_event, (event,)), psycopg.Error), "a past event date was accepted"
    assert isinstance(_direct_update(owner, past_opp, (opp,)), psycopg.Error), "a past deadline was accepted"


def test_the_only_administrator_cannot_delete_their_own_account(db):
    sole = db.member("soleadmin", admin=True)
    with psycopg.connect(DSN) as c, c.cursor() as cur:
        cur.execute("delete from public.admins where user_id <> %s", (sole,))   # rolled back below
        _as(cur, sole)
        with pytest.raises(psycopg.Error, match="only administrator"):
            cur.execute("select public.delete_my_account()")
        c.rollback()
    assert db.execute("select exists (select 1 from auth.users where id = %s)", (sole,)).fetchone()[0]


def test_an_administrator_can_delete_their_account_while_another_remains(db):
    leaving, staying = db.member("leavingadmin", admin=True), db.member("stayingadmin", admin=True)
    with psycopg.connect(DSN) as c, c.cursor() as cur:
        _as(cur, leaving)
        cur.execute("select public.delete_my_account()")
    assert not db.execute("select exists (select 1 from auth.users where id = %s)", (leaving,)).fetchone()[0]
    assert db.execute("select exists (select 1 from public.admins where user_id = %s)", (staying,)).fetchone()[0]


# ─── Former accepted risks (migration 20261026000020) ───────────────
def _service(cur) -> None:
    """Run as the service role, the way the Next.js cron routes do."""
    cur.execute("set local role service_role")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"role": "service_role"}),))


def test_two_administrators_deleting_each_other_at_once_leave_one_of_them(db):
    for i in range(8):
        a, b = db.member(f"mutuala{i}", admin=True), db.member(f"mutualb{i}", admin=True)
        barrier = threading.Barrier(2)
        out: dict = {}

        def delete(caller, target, key):
            try:
                with psycopg.connect(DSN) as c, c.cursor() as cur:
                    _as(cur, caller)
                    barrier.wait(5)
                    cur.execute("select * from public.admin_delete_user(%s, 'mutual')", (target,))
                out[key] = "deleted"
            except psycopg.Error as exc:
                out[key] = exc

        threads = [threading.Thread(target=delete, args=(a, b, "ab")), threading.Thread(target=delete, args=(b, a, "ba"))]
        for t in threads:
            t.start()
        for t in threads:
            t.join(15)
        survivors = db.execute("select count(*) from public.admins where user_id in (%s, %s)", (a, b)).fetchone()[0]
        assert survivors >= 1, f"round {i}: both administrators were deleted ({out})"


def test_an_administrator_deleted_mid_call_cannot_go_on_to_delete_another(db):
    a, b = db.member("midcalla", admin=True), db.member("midcallb", admin=True)
    first, second = hold_then_race(
        lambda cur: _one(cur, "select * from public.admin_delete_user(%s, 'first')", (b,)),
        lambda cur: _one(cur, "select * from public.admin_delete_user(%s, 'second')", (a,)),
        first_as=a, second_as=b,
    )
    assert first is not None
    assert isinstance(second, psycopg.Error), "a deleted administrator went on to delete the one who deleted them"
    assert db.execute("select exists (select 1 from public.admins where user_id = %s)", (a,)).fetchone()[0]


@pytest.mark.parametrize("table,col", [("profile_skills", "skill_id"), ("profile_sectors", "sector_id")])
def test_a_rejected_member_cannot_edit_their_skills_or_sectors(db, table, col):
    banned, pending, approved = db.member("rj" + table[8:10], status="rejected"), \
        db.member("pe" + table[8:10], status="pending_review"), db.member("ap" + table[8:10])
    sql = f"insert into public.{table} (profile_id, {col}) values (%s, 1) on conflict do nothing"
    assert _direct_update(approved, sql, (approved,)) == 1, "control: an approved member can edit"
    assert _direct_update(pending, sql, (pending,)) == 1, "control: onboarding must keep working"
    assert isinstance(_direct_update(banned, sql, (banned,)), psycopg.Error), "a rejected member edited their interests"
    db.execute(f"insert into public.{table} (profile_id, {col}) values (%s, 1) on conflict do nothing", (banned,))
    assert _direct_update(banned, f"delete from public.{table} where profile_id = %s", (banned,)) == 0


def _email_row(db, age_hours: float) -> uuid.UUID:
    return db.execute(
        """insert into public.outbound_email (to_address, subject, text_body, html_body, created_at)
           values ('r3@example.com', 's', 't', 'h', now() - make_interval(secs => %s)) returning id""",
        (age_hours * 3600,)).fetchone()[0]


def test_a_rate_limited_email_is_deferred_without_a_charge_until_it_is_a_day_old(db):
    fresh, stale = _email_row(db, 1), _email_row(db, 25)
    with psycopg.connect(DSN) as c, c.cursor() as cur:
        _service(cur)
        for row in (fresh, stale):
            cur.execute("select public.defer_outbound_email(%s, '429 slow down', 30)", (row,))
        c.commit()
    fresh_row = db.execute("select attempts, next_attempt_at > now() + interval '29 minutes', last_error "
                           "from public.outbound_email where id = %s", (fresh,)).fetchone()
    stale_row = db.execute("select attempts from public.outbound_email where id = %s", (stale,)).fetchone()
    assert fresh_row == (0, True, "429 slow down")
    assert stale_row == (1,), "a row refused for over a day must start counting toward burial"
    db.execute("delete from public.outbound_email where id in (%s, %s)", (fresh, stale))


def test_only_the_service_role_can_run_the_new_queue_functions(db):
    # has_function_privilege, not a call: a permission-denied SECURITY DEFINER call crashes the local image.
    for fn in ("public.defer_outbound_email(uuid, text, int)", "public.release_github_showcase_nudges(uuid[])"):
        granted = {role: db.execute("select has_function_privilege(%s, %s, 'execute')", (role, fn)).fetchone()[0]
                   for role in ("anon", "authenticated", "service_role")}
        assert granted == {"anon": False, "authenticated": False, "service_role": True}, (fn, granted)


def test_a_released_showcase_nudge_is_due_again(db):
    m = _due_nudge_member(db, "released")
    claimed = db.execute("select member_id from public.due_github_showcase_nudges(500)").fetchall()
    assert m in {r[0] for r in claimed}
    assert m not in {r[0] for r in db.execute("select member_id from public.due_github_showcase_nudges(500)").fetchall()}, \
        "control: a claimed member is not handed out twice"
    db.execute("select public.release_github_showcase_nudges(%s)", ([m],))
    assert m in {r[0] for r in db.execute("select member_id from public.due_github_showcase_nudges(500)").fetchall()}
