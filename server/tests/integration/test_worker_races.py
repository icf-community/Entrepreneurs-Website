"""Background publish vs a member's own action (concurrency audit, docs/audits/D10-concurrency-second-pass.md).

The CV and GitHub workers call slow external services (an LLM, embeddings,
the GitHub API) and then publish what they got. A member can act in that
window: remove the CV, upload a newer one, disconnect GitHub. These tests
run the real `process_ingest_cv` / `process_scan_github` against the local
database with only the slow external calls stubbed, and inject the member's
action *inside* the slow call, so the interleaving is forced, not hoped for.

What must hold whatever the order: data the member removed does not come
back, a newer upload is never displaced by an older one, a finished job run
again changes nothing, and a superseded CV costs nothing.

Opt-in like the other integration tests (AI_INTEGRATION_DSN, local only).
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from contextlib import contextmanager
from types import SimpleNamespace

import psycopg
import pytest

from app import cv_pipeline, github_pipeline, worker
from app.cv_pipeline import Chunk, ExtractionResult, SkillMatch
from app.cv_sanitise import SanitisedCv

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")


# ─── World ──────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def db():
    conn = psycopg.connect(DSN, autocommit=True)
    created: list[uuid.UUID] = []
    keys: list[str] = []
    tag = uuid.uuid4().hex[:6]

    def member(name: str) -> uuid.UUID:
        """An approved alum: students cannot remove a CV, and removal is one of the races."""
        uid = uuid.uuid4()
        conn.execute(
            """insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token,
                 recovery_token, email_change_token_new, email_change, aud, role)
               values (%s, %s, %s, '{"provider":"email"}', '', '', '', '', 'authenticated', 'authenticated')""",
            (uid, f"wr-{name}-{tag}@example.com",
             json.dumps({"first_name": "Wr", "surname": name.title(), "role": "alum", "grad_year": 2020})),
        )
        with conn.transaction():
            conn.execute("select set_config('foundry.onboarding_submission', 'true', true)")
            conn.execute("update public.profiles set status = 'approved', course = 'Computing', "
                         "linkedin_url = 'https://www.linkedin.com/in/wr' where id = %s", (uid,))
        created.append(uid)
        return uid

    def cv(uid: uuid.UUID, *, current: bool = True) -> tuple[uuid.UUID, str]:
        """A pending cvs row; `current` points the member's profile at its blob, as confirm_cv_upload does."""
        key = f"wr-{uuid.uuid4()}.cv"
        keys.append(key)
        cv_id = conn.execute("insert into public.cvs (member_id, blob_key, original_filename) "
                             "values (%s, %s, 'cv.pdf') returning id", (uid, key)).fetchone()[0]
        if current:
            with conn.transaction():
                conn.execute("select set_config('foundry.media_write', 'true', true)")
                conn.execute("update public.profiles set cv_path = %s, cv_uploaded_at = now(), "
                             "cv_parse_consent = true, cv_parse_consent_at = now() where id = %s", (key, uid))
        return cv_id, key

    conn.member = member  # type: ignore[attr-defined]
    conn.cv = cv  # type: ignore[attr-defined]
    yield conn
    for uid in created:
        conn.execute("delete from public.jobs where payload->>'member_id' = %s or payload->>'cv_id' in "
                     "(select id::text from public.cvs where member_id = %s)", (str(uid), uid))
        conn.execute("delete from auth.users where id = %s", (uid,))
    conn.execute("delete from public.jobs where kind = 'revoke_github_token' "
                 "and (payload->>'github_user_id')::bigint between 777000000 and 777999999")
    conn.execute("delete from public.blob_deletion_queue where blob_key = any(%s)", (keys,))
    conn.close()


def _member_call(uid: uuid.UUID, sql: str, params: tuple = ()) -> None:
    """Run one statement as a signed-in member on its own connection and commit, the way PostgREST does."""
    with psycopg.connect(DSN) as c, c.cursor() as cur:
        cur.execute("set local role authenticated")
        cur.execute("select set_config('request.jwt.claims', %s, true)",
                    (json.dumps({"sub": str(uid), "role": "authenticated"}),))
        cur.execute(sql, params)


class Pipeline:
    def __init__(self) -> None:
        self.extract_calls = 0
        self.on_extract = None   # runs inside the (stubbed) slow LLM call
        self.on_fetch = None     # runs inside the (stubbed) GitHub fetch
        self.on_synthesise = None  # runs inside the (stubbed) summary LLM call
        self.text = None           # when set, every CV reads as this text (an identical re-upload)


@pytest.fixture
def pipe(monkeypatch):
    """The real worker code against the real database, with only the slow external calls replaced."""
    p = Pipeline()

    @contextmanager
    def connection():
        conn = psycopg.connect(DSN)
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    monkeypatch.setattr(worker, "connection", connection)
    monkeypatch.setattr(worker, "worker_settings", lambda: SimpleNamespace(
        cv_container="member-cvs", github_token_encryption_key="k",
        github_oauth_client_id="", github_oauth_client_secret=""))

    def sanitise(cv_id, container, blob_key):
        text = p.text or f"cv text for {blob_key}"
        return SanitisedCv(raw_text=text, raw_text_hash=hashlib.sha256(text.encode()).hexdigest(), flagged=False)

    def extract(_text):
        p.extract_calls += 1
        if p.on_extract:
            p.on_extract()
        return ExtractionResult(profile={"skills_raw": ["Python"], "summary": "CV only summary"},
                                summary="CV only summary", model_name="fake",
                                prompt_version=cv_pipeline.EXTRACTION_PROMPT_VERSION)

    def fetch(_token, _username, previous_fingerprint=None):
        if p.on_fetch:
            p.on_fetch()
        return SimpleNamespace(unchanged=False, languages=["Python"], available_repos=[], fingerprint="fp",
                               as_signal_dict=lambda: {"top_repos": []})

    def synthesise(_profile, _signal):
        if p.on_synthesise:
            p.on_synthesise()
        return "Combined summary with GitHub evidence"

    monkeypatch.setattr(worker, "_sanitise_cv", sanitise)
    monkeypatch.setattr(worker.privacy, "minimise", lambda text, ids, max_chars=None: SimpleNamespace(text=text))
    monkeypatch.setattr(worker.ledger, "current_identifiers", lambda: None)
    monkeypatch.setattr(worker, "moderate_cv", lambda text: SimpleNamespace(flagged=False, categories=[]))
    monkeypatch.setattr(cv_pipeline, "extract_profile", extract)
    monkeypatch.setattr(cv_pipeline, "normalise_skills", lambda raw, conn: [SkillMatch("Python", None, None, 0.9)])
    monkeypatch.setattr(cv_pipeline, "chunk_and_embed",
                        lambda profile: [Chunk("summary", "CV only summary", [0.0] * 1536, "fake")])
    monkeypatch.setattr(cv_pipeline, "re_embed_summary",
                        lambda text: Chunk("summary", text, [0.0] * 1536, "fake"))
    monkeypatch.setattr(github_pipeline, "fetch_github_signal", fetch)
    monkeypatch.setattr(github_pipeline, "synthesize_combined_summary", synthesise)
    return p


def _scalar(db, sql: str, params: tuple = ()):
    return db.execute(sql, params).fetchone()[0]


def _cv_skills(db, uid) -> int:
    return _scalar(db, "select count(*) from public.member_skills where member_id = %s and source = 'cv'", (uid,))


def _github_skills(db, uid) -> int:
    return _scalar(db, "select count(*) from public.member_skills where member_id = %s and source = 'github'", (uid,))


def _connect_github(db, uid) -> None:
    db.execute(
        "insert into public.github_connections (member_id, github_user_id, github_username, access_token_encrypted, scan_status) "
        "values (%s, %s, 'wr-user', extensions.pgp_sym_encrypt('tok', 'k'), 'pending')",
        (uid, 777_000_000 + uuid.uuid4().int % 999_999))


# ─── The CV: removed, replaced, repeated ────────────────────────────
def test_removing_the_cv_while_it_is_being_read_publishes_nothing(db, pipe):
    """Before: the job finished after remove_my_cv and wrote the profile, the chunks and the member's
    skills back, and marked the removed CV current. Data the member deleted came back."""
    uid = db.member("remover")
    cv_id, _ = db.cv(uid)
    pipe.on_extract = lambda: _member_call(uid, "select public.remove_my_cv()")

    worker.process_ingest_cv(cv_id)

    assert pipe.extract_calls == 1
    assert _cv_skills(db, uid) == 0, "skills from the removed CV came back"
    assert _scalar(db, "select count(*) from public.cvs where member_id = %s and is_current", (uid,)) == 0
    assert _scalar(db, "select count(*) from public.cv_profiles where cv_id = %s", (cv_id,)) == 0
    assert _scalar(db, "select count(*) from public.cv_chunks where cv_id = %s", (cv_id,)) == 0
    assert _scalar(db, "select count(*) from public.cvs where id = %s", (cv_id,)) == 0


def test_an_older_upload_finishing_late_does_not_replace_the_newer(db, pipe):
    """Two uploads in flight on different workers. Before: whichever finished last became current, even
    the older one, while the member's profile pointed at the newer. Also: the superseded CV must cost nothing."""
    uid = db.member("replacer")
    old_id, _ = db.cv(uid, current=False)
    new_id, _ = db.cv(uid, current=True)

    worker.process_ingest_cv(new_id)     # the newer upload finishes first (and clears away what it replaced)
    assert pipe.extract_calls == 1
    worker.process_ingest_cv(old_id)     # the older job runs late and finds nothing to do

    assert pipe.extract_calls == 1, "a superseded CV paid for an extraction"
    current = db.execute("select id from public.cvs where member_id = %s and is_current", (uid,)).fetchall()
    assert current == [(new_id,)], "the older upload displaced the newer one"
    assert _scalar(db, "select count(*) from public.cvs where id = %s", (old_id,)) == 0


def test_a_superseded_cv_still_queued_costs_nothing_and_is_cleared_when_the_newer_one_finishes(db, pipe):
    uid = db.member("queued")
    old_id, _ = db.cv(uid, current=False)
    new_id, _ = db.cv(uid, current=True)

    worker.process_ingest_cv(old_id)     # the old job gets there first, while the newer one is still waiting

    assert pipe.extract_calls == 0, "a superseded CV paid for an extraction"
    assert _scalar(db, "select status::text from public.cvs where id = %s", (old_id,)) == "failed"

    worker.process_ingest_cv(new_id)

    assert _scalar(db, "select count(*) from public.cvs where id = %s", (old_id,)) == 0, "the superseded row's text was kept"
    assert db.execute("select id from public.cvs where member_id = %s and is_current", (uid,)).fetchall() == [(new_id,)]


def test_removing_a_cv_deletes_everything_extracted_from_it(db, pipe):
    """Before: removal only flagged the rows not current. The full text, the profile and the embeddings stayed
    in the database indefinitely, and nothing deleted them."""
    uid = db.member("eraser")
    cv_id, _ = db.cv(uid)
    worker.process_ingest_cv(cv_id)
    assert _scalar(db, "select raw_text is not null from public.cvs where id = %s", (cv_id,))
    assert _scalar(db, "select count(*) from public.cv_chunks where cv_id = %s", (cv_id,)) == 1

    _member_call(uid, "select public.remove_my_cv()")

    for table, column in (("cvs", "member_id"), ("cv_profiles", None), ("cv_chunks", "member_id")):
        if column:
            assert _scalar(db, f"select count(*) from public.{table} where {column} = %s", (uid,)) == 0, table
        else:
            assert _scalar(db, "select count(*) from public.cv_profiles where cv_id = %s", (cv_id,)) == 0, table
    assert _cv_skills(db, uid) == 0


def test_a_new_upload_deletes_the_text_of_the_cv_it_replaces(db, pipe):
    uid = db.member("swapper")
    first_id, _ = db.cv(uid)
    worker.process_ingest_cv(first_id)
    second_id, _ = db.cv(uid)            # the member uploads a different CV; the profile now points at it

    worker.process_ingest_cv(second_id)

    assert _scalar(db, "select count(*) from public.cvs where id = %s", (first_id,)) == 0
    assert _scalar(db, "select count(*) from public.cv_chunks where cv_id = %s", (first_id,)) == 0
    assert _scalar(db, "select count(*) from public.cv_profiles where cv_id = %s", (first_id,)) == 0
    assert _scalar(db, "select status::text from public.cvs where id = %s", (second_id,)) == "ready"


def test_re_uploading_the_identical_cv_still_reuses_the_extraction(db, pipe):
    """The one reuse that survives the clean-up: the current CV is kept, so an identical re-upload matches it
    and costs nothing. Both rows stay, because the profile points at the new blob and currency at the earlier row."""
    uid = db.member("twin")
    pipe.text = "the very same cv text"
    first_id, _ = db.cv(uid)
    worker.process_ingest_cv(first_id)
    assert pipe.extract_calls == 1
    second_id, _ = db.cv(uid)

    worker.process_ingest_cv(second_id)

    assert pipe.extract_calls == 1, "an identical CV was extracted again"
    assert _scalar(db, "select status::text from public.cvs where id = %s", (second_id,)) == "ready"
    assert _scalar(db, "select count(*) from public.cvs where id = %s", (first_id,)) == 1
    assert db.execute("select id from public.cvs where member_id = %s and is_current", (uid,)).fetchall() == [(first_id,)]


def test_a_job_for_a_cv_that_no_longer_exists_stops_quietly(db, pipe):
    """The member removed the CV (or it was replaced) while the job sat in the queue. That is not a failure to retry
    five times and dead-letter."""
    worker.process_ingest_cv(uuid.uuid4())
    assert pipe.extract_calls == 0


def test_a_finished_job_run_again_changes_nothing(db, pipe):
    """The reaper requeues a job left 'running'. If the first run had already committed, the second must
    not pay for another extraction, hit the unique cv_profiles.cv_id, or flip a good CV to failed."""
    uid = db.member("rerun")
    cv_id, _ = db.cv(uid)

    worker.process_ingest_cv(cv_id)
    assert _scalar(db, "select status::text from public.cvs where id = %s", (cv_id,)) == "ready"

    worker.process_ingest_cv(cv_id)

    assert pipe.extract_calls == 1, "a finished CV was extracted again"
    assert _scalar(db, "select status::text from public.cvs where id = %s", (cv_id,)) == "ready"
    assert _scalar(db, "select count(*) from public.cv_profiles where cv_id = %s", (cv_id,)) == 1


def test_a_cv_removed_before_the_job_starts_costs_nothing(db, pipe):
    uid = db.member("early")
    cv_id, _ = db.cv(uid)
    _member_call(uid, "select public.remove_my_cv()")

    worker.process_ingest_cv(cv_id)

    assert pipe.extract_calls == 0
    assert _cv_skills(db, uid) == 0


# ─── GitHub: disconnected mid-scan ──────────────────────────────────
def test_disconnecting_github_during_a_scan_leaves_no_github_skills(db, pipe):
    """Before: disconnect_github deleted the skills, then the finishing scan wrote them back for a member
    who had disconnected."""
    uid = db.member("disconnector")
    _connect_github(db, uid)
    pipe.on_fetch = lambda: _member_call(uid, "select public.disconnect_github()")

    worker.process_scan_github(uid)

    assert _scalar(db, "select count(*) from public.github_connections where member_id = %s", (uid,)) == 0
    assert _github_skills(db, uid) == 0, "GitHub skills came back after the member disconnected"


def test_a_summary_with_github_evidence_is_not_written_after_disconnect(db, pipe):
    """The tail of a scan folds GitHub into the CV summary through a second LLM call. Disconnecting during
    that call must not leave GitHub text in the summary."""
    uid = db.member("summariser")
    cv_id, _ = db.cv(uid)
    worker.process_ingest_cv(cv_id)
    assert _scalar(db, "select summary_source from public.cv_profiles where cv_id = %s", (cv_id,)) == "cv"
    _connect_github(db, uid)
    pipe.on_synthesise = lambda: _member_call(uid, "select public.disconnect_github()")

    worker.process_scan_github(uid)

    assert _scalar(db, "select summary_source from public.cv_profiles where cv_id = %s", (cv_id,)) == "cv", \
        "a summary with GitHub evidence was written after the member disconnected"


# ─── The skills suggestion written by the page after an upload ──────
def test_a_late_skill_suggestion_for_a_replaced_cv_is_ignored(db):
    """confirmCvUpload parses the file after responding and then saves suggested skills. It must say which CV
    it parsed: a replaced or removed CV's suggestions must not land on the member's profile."""
    uid = db.member("suggester")
    _, old_key = db.cv(uid, current=True)
    _, new_key = db.cv(uid, current=True)

    _member_call(uid, "select public.set_cv_suggested_skills(%s::smallint[], %s)", ([1, 2], old_key))
    assert _scalar(db, "select cv_suggested_skill_ids from public.profiles where id = %s", (uid,)) is None, \
        "a replaced CV's suggestions were saved"

    _member_call(uid, "select public.set_cv_suggested_skills(%s::smallint[], %s)", ([3], new_key))
    assert _scalar(db, "select cv_suggested_skill_ids from public.profiles where id = %s", (uid,)) == [3]

    _member_call(uid, "select public.remove_my_cv()")
    _member_call(uid, "select public.set_cv_suggested_skills(%s::smallint[], %s)", ([4], new_key))
    assert _scalar(db, "select cv_suggested_skill_ids from public.profiles where id = %s", (uid,)) is None, \
        "suggestions from a removed CV came back"
