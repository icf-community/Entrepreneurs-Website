"""End to end against a real local Supabase (AI-evaluation-plan §2,
"local integration"): real migrations, RLS and functions, the real worker
projection code and the real executor pipeline, with the fake provider.

Opt-in, because it needs the local stack:

    AI_INTEGRATION_DSN=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
      venv/bin/python -m pytest tests/integration -q

It creates its own members and job, commits them (the worker and the
executor use their own logins and connections), and deletes them again.
Never point it at anything but a local database: fake_provider refuses to
run otherwise, and the cleanup deletes accounts.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import psycopg
import pytest

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")

CV_WORKER_PASSWORD = "cv_worker-local"
AI_SERVICE_PASSWORD = "ai_service-local"


def _dsn_for(role: str, password: str) -> str:
    params = psycopg.conninfo.conninfo_to_dict(DSN)
    params.update(user=role, password=password, sslmode="disable")
    return psycopg.conninfo.make_conninfo(**params)


def _sql(conn, query: str, params: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall() if cur.description else None


def as_member(conn, uid: uuid.UUID, query: str, params: tuple = ()):
    """Run one statement as a signed-in member, the way PostgREST does."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)",
                        (json.dumps({"sub": str(uid), "role": "authenticated"}),))
            cur.execute(query, params)
            return cur.fetchall() if cur.description else None


@pytest.fixture(scope="module")
def world():
    conn = psycopg.connect(DSN, autocommit=True)
    _sql(conn, f"alter role ai_service password '{AI_SERVICE_PASSWORD}'")
    _sql(conn, f"alter role cv_worker password '{CV_WORKER_PASSWORD}'")
    saved_flags = dict(_sql(conn, "select key, value from public.app_config where key like 'ai_%%'"))
    _sql(conn, "update public.app_config set value = 'true' where key in "
               "('ai_enabled', 'ai_recruiter_enabled', 'ai_network_enabled', 'ai_opportunities_enabled')")

    tag = uuid.uuid4().hex[:8]
    members: dict[str, uuid.UUID] = {}
    try:
        yield from _build_world(conn, tag, members, saved_flags)
    except BaseException:
        _cleanup(conn, members, saved_flags)
        raise


def _build_world(conn, tag, members, saved_flags):

    def member(key, *, role, first, surname, course, skills=(), bio_focus=None, hobbies=None, recruiter=False,
               network=False, evidence=False, enrolled=None, graduated=None, cv_skills=None, committee=False):
        uid = uuid.uuid4()
        email = f"ai-{key}-{tag}@imperial.ac.uk"
        _sql(conn, """
            insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token,
                                    recovery_token, email_change_token_new, email_change, aud, role)
            values (%s, %s, %s, '{"provider":"email"}', '', '', '', '', 'authenticated', 'authenticated')
        """, (uid, email, json.dumps({"first_name": first, "surname": surname, "role": role,
                                      "grad_year": 2028 if role == "student" else 2020})))
        with conn.transaction():
            # The trusted-call marker submit_onboarding uses; approval is
            # otherwise an admin action.
            _sql(conn, "select set_config('foundry.onboarding_submission', 'true', true)")
            _sql(conn, "update public.profiles set status = 'approved', course = %s, bio_focus = %s, "
                       "bio_hobbies = %s, is_committee = %s, cv_parse_consent = %s where id = %s",
                 (course, bio_focus, hobbies, committee, cv_skills is not None, uid))
        for name in skills:
            _sql(conn, "insert into public.profile_skills (profile_id, skill_id) "
                       "select %s, id from public.skills where name = %s", (uid, name))
        if enrolled is not None:
            _sql(conn, "insert into public.member_education (member_id, currently_enrolled, has_completed_degree) "
                       "values (%s, %s, %s)", (uid, enrolled, graduated))
        if recruiter or network or evidence:
            _sql(conn, "insert into ai_private.member_settings (member_id, recruiter_discoverable, network_discoverable, "
                       "evidence_sharing, consent_version, consent_epoch) values (%s, %s, %s, %s, 'test', 1)",
                 (uid, recruiter, network, evidence))
        if cv_skills is not None:
            cv_id = uuid.uuid4()
            _sql(conn, "insert into public.cvs (id, member_id, blob_key, status, is_current) "
                       "values (%s, %s, %s, 'ready', true)", (cv_id, uid, f"k-{cv_id}"))
            profile = {"skills_raw": cv_skills, "roles": [], "projects": [
                {"name": "Vision model", "description": "Trained an image classifier end to end.",
                 "technologies": cv_skills}], "education": [], "summary": "x", "links": [], "languages": []}
            _sql(conn, "insert into public.cv_profiles (cv_id, profile, summary, model_name, prompt_version, "
                       "policy_version, is_current) values (%s, %s, 'x', 'm', 'extract-v8', 'outbound-v1', true)",
                 (cv_id, json.dumps(profile)))
        members[key] = uid
        return uid

    recruiter = member("rec", role="alum", first="Rhea", surname="Recruiter", course="Computing",
                       enrolled=False, graduated=True)
    a = member("a", role="student", first="Asha", surname="Alpha", course="Computing", skills=["Deep learning"],
               bio_focus="Building PyTorch vision models", hobbies="Chess and climbing", recruiter=True,
               network=True, evidence=True, enrolled=True, graduated=False, cv_skills=["PyTorch", "Python"])
    b = member("b", role="alum", first="Ben", surname="Beta", course="Physics", skills=["Machine learning"],
               bio_focus="Research with TensorFlow", recruiter=True, network=True, enrolled=False, graduated=True,
               cv_skills=["TensorFlow"])
    c = member("c", role="student", first="Cara", surname="Gamma", course="Computing",
               bio_focus="PyTorch and FastAPI", enrolled=True, graduated=False)  # not discoverable
    blocked = member("d", role="student", first="Dev", surname="Delta", course="Computing",
                     bio_focus="PyTorch research", recruiter=True, network=True, enrolled=True, graduated=False,
                     cv_skills=["PyTorch"])
    committee = member("e", role="student", first="Eli", surname="Epsilon", course="Computing",
                       bio_focus="PyTorch everything", recruiter=True, network=True, enrolled=True, graduated=False,
                       cv_skills=["PyTorch"], committee=True)
    _sql(conn, "insert into public.connections (requester_id, addressee_id, status, blocked_by, decided_at) "
               "values (%s, %s, 'blocked', %s, now())", (recruiter, blocked, recruiter))

    job = uuid.uuid4()
    _sql(conn, """
        insert into public.opportunities (id, posted_by, status, position_name, company, pay, location_type,
          description, start_month, start_year, application_deadline, contact_email, apply_method,
          approved_at, approved_by, eligible_audience, creation_source)
        values (%s, %s, 'approved', 'ML Intern', 'Acme', 'Paid', 'remote',
          'We are hiring an ML intern. You must know PyTorch. Python is a plus.', 6, 2027,
          current_date + 30, 'jobs@acme.test', 'email', now(), %s, 'both', 'member')
    """, (job, recruiter, recruiter))
    admin_job = uuid.uuid4()
    _sql(conn, """
        insert into public.opportunities (id, posted_by, status, position_name, company, pay, location_type,
          description, start_month, start_year, application_deadline, contact_email, apply_method,
          approved_at, approved_by, eligible_audience, creation_source)
        values (%s, %s, 'approved', 'Data Analyst', 'Beta Co', 'Paid', 'onsite',
          'Analyst role using Python and SQL dashboards for the team.', 6, 2027,
          current_date + 30, 'jobs@beta.test', 'email', now(), %s, 'graduates', 'admin')
    """, (admin_job, recruiter, recruiter))

    world = {"conn": conn, "members": members, "job": job, "admin_job": admin_job, "recruiter": recruiter,
             "a": a, "b": b, "c": c, "blocked": blocked, "committee": committee}
    yield world
    _cleanup(conn, members, saved_flags)


def _cleanup(conn, members: dict, saved_flags: dict) -> None:
    ids = [str(uid) for uid in members.values()]
    for uid in members.values():
        _sql(conn, "delete from public.opportunities where posted_by = %s", (uid,))
        _sql(conn, "delete from auth.users where id = %s", (uid,))
    # Refreshes the triggers queued while AI was on; no worker runs here.
    _sql(conn, "delete from public.jobs where kind in ('refresh_member_ai', 'refresh_job_ai') "
               "and status = 'pending'")
    for key, value in saved_flags.items():
        _sql(conn, "update public.app_config set value = %s where key = %s", (value, key))
    conn.close()


@pytest.fixture(scope="module")
def built(world):
    """Run the real worker projection code for everyone, as cv_worker."""
    env = {
        "DATABASE_URL": _dsn_for("cv_worker", CV_WORKER_PASSWORD),
        "OPENAI_PROVIDER": "fake",
        "OPENAI_API_KEY": "unused-by-the-fake",
        "GITHUB_TOKEN_ENCRYPTION_KEY": "unused",
        "AZURE_CV_CONTAINER": "unused",
        "GITHUB_OAUTH_CLIENT_ID": "unused",
        "GITHUB_OAUTH_CLIENT_SECRET": "unused",
    }
    old = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    from app import config, ledger, openai_client, projection

    config.worker_settings.cache_clear()
    openai_client.client.cache_clear()
    try:
        for uid in world["members"].values():
            with ledger.job_context(None, uid):
                projection.process_refresh_member_ai(uid)
        for job in (world["job"], world["admin_job"]):
            projection.process_refresh_job_ai(job)
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        config.worker_settings.cache_clear()
        openai_client.client.cache_clear()
    return world


def _run_executor_once() -> None:
    os.environ["AI_DATABASE_URL"] = _dsn_for("ai_service", AI_SERVICE_PASSWORD)
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
        try:
            while True:
                ctx = await db.one("select ai_private.exec_claim(%s)", ("test",))
                if ctx is None:
                    return
                await run_turn(db, FakeProvider(), settings, await _DictionaryCache().get(db), ctx)
        finally:
            await db.close()

    asyncio.run(go())


def _submit(conn, uid, mode, message, *, conversation=None, opportunity=None, kind="message", revision=None):
    rows = as_member(conn, uid, "select * from public.ai_submit_turn(%s, %s, %s, %s, %s, %s, %s, false)",
                     (mode, conversation, opportunity, kind, message, uuid.uuid4().hex, revision))
    return rows[0]


def _cards(conn, uid, turn):
    return as_member(conn, uid, "select slot, kind, target_id, title, score, tier, coverage, evidence, stale "
                                "from public.ai_result_cards(%s)", (turn,))


def _status(conn, uid, turn):
    return as_member(conn, uid, "select status, outcome, result_count from public.ai_turn_status(%s)", (turn,))[0]


def test_projections_respect_consent_and_committee(built):
    conn = built["conn"]
    purposes = dict(_sql(conn, "select member_id, array_agg(purpose order by purpose) from ai_private.member_docs "
                               "where member_id = any(%s) group by member_id", (list(built["members"].values()),)))
    assert purposes[built["a"]] == ["network", "recruiter", "self"]
    assert purposes[built["c"]] == ["self"]
    assert purposes[built["committee"]] == ["self"]
    spend = _sql(conn, "select count(*), bool_and(status = 'settled') from ai_private.spend "
                       "where purpose = 'ingestion' and member_id = %s", (built["a"],))[0]
    assert spend[0] >= 1 and spend[1], "every embedding call was reserved and settled"


def test_recruiter_requires_confirmed_requirements_then_finds_eligible_candidates(built):
    conn, rec, job = built["conn"], built["recruiter"], built["job"]
    turn, conv, outcome, _ = _submit(conn, rec, "recruiter", "must know pytorch", opportunity=job)
    assert outcome == "requirements_unconfirmed"

    reqs = as_member(conn, rec, "select public.ai_get_job_requirements(%s)", (job,))[0][0]
    assert reqs["status"] == "parsed"
    pytorch = [a for a in reqs["atoms"] if a["concept"] == "pytorch"]
    assert pytorch and pytorch[0]["required"] is True
    as_member(conn, rec, "select public.ai_confirm_job_requirements(%s, %s)",
              (job, json.dumps([{"id": a["id"], "required": a["required"]} for a in reqs["atoms"]])))

    turn, conv, outcome, _ = _submit(conn, rec, "recruiter", "also python", opportunity=job)
    assert outcome == "queued"
    _run_executor_once()
    status = _status(conn, rec, turn)
    assert status[0] == "completed", status
    cards = _cards(conn, rec, turn)
    by_id = {row[2]: row for row in cards}
    assert built["a"] in by_id and by_id[built["a"]][5] == "meets"
    assert built["c"] not in by_id, "not discoverable"
    assert built["blocked"] not in by_id, "blocked"
    assert built["committee"] not in by_id, "committee members are not in the directory"
    if built["b"] in by_id:
        assert by_id[built["b"]][5] != "meets", "TensorFlow alone never meets a PyTorch requirement"
    assert by_id[built["a"]][3] == "Asha Alpha"


def test_withdrawal_hides_existing_results_immediately(built):
    conn, rec, job, a = built["conn"], built["recruiter"], built["job"], built["a"]
    turn, conv, outcome, _ = _submit(conn, rec, "recruiter", "pytorch", opportunity=job)
    _run_executor_once()
    assert any(row[2] == a for row in _cards(conn, rec, turn))
    as_member(conn, a, "select public.set_my_ai_settings(false, true, true, true, '{}', '{}', '{}', '{}', 'test')")
    assert not any(row[2] == a for row in _cards(conn, rec, turn)), "withdrawal is an immediate read deny"
    as_member(conn, a, "select public.set_my_ai_settings(true, true, true, true, '{}', '{}', '{}', '{}', 'test')")


def test_admin_created_job_never_unlocks_recruiter_mode(built):
    conn = built["conn"]
    _, _, outcome, _ = _submit(conn, built["recruiter"], "recruiter", "python", opportunity=built["admin_job"])
    assert outcome == "job_not_eligible"


def test_network_refinement_keeps_earlier_criteria(built):
    conn, b = built["conn"], built["b"]
    turn, conv, outcome, _ = _submit(conn, b, "network", "deep learning")
    assert outcome == "queued"
    _run_executor_once()
    assert _status(conn, b, turn)[0] == "completed"
    revision = as_member(conn, b, "select public.ai_get_conversation(%s)", (conv,))[0][0]["spec_revision"]
    turn2, _, outcome, _ = _submit(conn, b, "network", "must also like chess", conversation=conv, revision=revision)
    assert outcome == "queued"
    _run_executor_once()
    spec = as_member(conn, b, "select public.ai_get_conversation(%s)", (conv,))[0][0]["spec"]
    labels = {atom["label"]: atom["required"] for atom in spec["atoms"]}
    assert "Deep learning" in labels and labels.get("Chess") is True
    cards = _cards(conn, b, turn2)
    # Asha meets both; anyone else is shown only as a labelled partial
    # match, never as meeting "must like chess" (§7.3).
    assert cards[0][2] == built["a"] and cards[0][5] == "meets"
    assert all(row[5] != "meets" for row in cards[1:])


def test_off_task_and_sensitive_requests_are_refused_without_results(built):
    conn, b = built["conn"], built["b"]
    turn, *_ = _submit(conn, b, "network", "explain the pythagorean theorem")
    _run_executor_once()
    assert _status(conn, b, turn)[:2] == ("refused", "off_task")
    turn, *_ = _submit(conn, b, "network", "find young women who know python")
    _run_executor_once()
    assert _status(conn, b, turn)[:2] == ("refused", "sensitive")


def test_named_person_search_is_refused_at_admission(built):
    _, _, outcome, _ = _submit(built["conn"], built["b"], "network", "find Asha Alpha")
    assert outcome == "named_person"


def test_opportunities_respects_audience_and_own_jobs(built):
    conn = built["conn"]
    # Asha is enrolled: the Both job is hers to see; the graduates-only one is not.
    turn, *_ = _submit(conn, built["a"], "opportunities", "find jobs for me")
    _run_executor_once()
    ids = [row[2] for row in _cards(conn, built["a"], turn)]
    assert built["job"] in ids and built["admin_job"] not in ids
    # Ben has graduated: both are visible to him.
    turn, *_ = _submit(conn, built["b"], "opportunities", "find jobs for me")
    _run_executor_once()
    ids = [row[2] for row in _cards(conn, built["b"], turn)]
    assert built["admin_job"] in ids and built["job"] in ids
    # The poster never gets their own jobs back.
    turn, *_ = _submit(conn, built["recruiter"], "opportunities", "python jobs")
    _run_executor_once()
    ids = [row[2] for row in _cards(conn, built["recruiter"], turn)]
    assert built["job"] not in ids and built["admin_job"] not in ids


def test_idempotent_resubmission_returns_the_same_turn(built):
    # Cara has made no turns, so the per-minute limit doesn't interfere.
    conn, b = built["conn"], built["c"]
    key = uuid.uuid4().hex
    first = as_member(conn, b, "select * from public.ai_submit_turn('network', null, null, 'message', 'rust', %s, null, false)", (key,))[0]
    again = as_member(conn, b, "select * from public.ai_submit_turn('network', null, null, 'message', 'rust', %s, null, false)", (key,))[0]
    clash = as_member(conn, b, "select * from public.ai_submit_turn('network', null, null, 'message', 'go', %s, null, false)", (key,))[0]
    assert again[0] == first[0] and again[2] == "duplicate"
    assert clash[2] == "idempotency_conflict"
    _run_executor_once()


def test_per_minute_limit_is_shared_across_modes(built):
    conn, b = built["conn"], built["b"]
    # Ben has used his five this minute across network and opportunities.
    _, _, outcome, retry_at = _submit(conn, b, "opportunities", "python")
    assert outcome == "rate_minute" and retry_at is not None


def test_executor_role_cannot_touch_tables(built):
    with psycopg.connect(_dsn_for("ai_service", AI_SERVICE_PASSWORD)) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select 1 from public.profiles limit 1")
    with psycopg.connect(_dsn_for("ai_service", AI_SERVICE_PASSWORD)) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select 1 from ai_private.turns limit 1")
