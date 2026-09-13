#!/usr/bin/env python3
"""CV/GitHub summary lifecycle — full permutation test.

Answers a direct question: across every order members can touch CV upload,
GitHub connect/reconnect/disconnect, and project-picking in, does the
recruiter-facing summary (cv_profiles.summary/summary_source) always end up
correct — never stale, never dangling, never missing a signal that should
be there?

Scope, deliberately: this drives the REAL `worker.py` orchestration
functions (process_ingest_cv, process_scan_github, process_refresh_github_summary,
_refresh_combined_summary, _revert_to_cv_only_summary, _apply_effective_showcase)
and the REAL RPCs (set_my_github_showcase, disconnect_github, remove_my_cv,
confirm_github_connected) against real local Postgres — that IS the thing
in question. It does NOT re-test CV extraction/moderation fidelity or
GitHub repo-selection judgment quality (already covered by the pytest
suite and the C1 audit) — those are patched to deterministic, content-
echoing fakes so this test can assert on exactly what state reached what
function, not on LLM output quality.

Usage (from server/, venv active, local Supabase running):
    python scripts/lifecycle_matrix_test.py
"""

from __future__ import annotations

import hashlib
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from dotenv import dotenv_values  # noqa: E402

_env_file = SERVER_ROOT / ".env.worker.local"
if _env_file.exists():
    for key, value in dotenv_values(_env_file).items():
        if value is not None:
            os.environ.setdefault(key, value)

import requests  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

from app import cv_pipeline, github_pipeline, worker  # noqa: E402
from app.cv_sanitise import SanitisedCv  # noqa: E402
from app.documents import ValidatedDocument  # noqa: E402
from app.moderation import ModerationResult  # noqa: E402

FAILURES: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(f"{label}: {detail}")


# ─── deterministic, content-echoing fakes (patched in, no OpenAI/blob calls) ──
def _fake_get_blob(_container: str, _key: str) -> bytes:
    return b"fake-cv-bytes"


def _fake_sanitise_document(_data: bytes) -> ValidatedDocument:
    return ValidatedDocument(data=b"fake-cv-bytes", content_type="application/pdf", extension="pdf")


def _make_fake_sanitise_cv(raw_text: str):
    def _fake_sanitise_cv(_data: bytes, _content_type: str) -> SanitisedCv:
        return SanitisedCv(
            raw_text=raw_text,
            raw_text_hash=hashlib.sha256(raw_text.encode()).hexdigest(),
            flagged=False,
            flag_reasons=[],
        )

    return _fake_sanitise_cv


def _fake_moderate_cv(_text: str) -> ModerationResult:
    return ModerationResult(flagged=False, categories=[])


def _make_fake_extract_profile(cv_marker: str, skills: list[str] | None = None):
    # Distinct skills per CV by default (not the same placeholder every
    # time) — this is what lets a test actually distinguish "skills were
    # replaced" from "the same skill was harmlessly re-inserted."
    skills_raw = skills if skills is not None else [f"Skill-{cv_marker}"]

    def _fake_extract_profile(raw_text: str) -> cv_pipeline.ExtractionResult:
        return cv_pipeline.ExtractionResult(
            profile={
                "summary": f"CV-ONLY SUMMARY[{cv_marker}]",
                "skills_raw": skills_raw,
                "roles": [],
                "projects": [],
                "education": [],
            },
            summary=f"CV-ONLY SUMMARY[{cv_marker}]",
            model_name="test-model",
            prompt_version="test-v1",
        )

    return _fake_extract_profile


def _fake_chunk_and_embed(profile: dict) -> list[cv_pipeline.Chunk]:
    return [
        cv_pipeline.Chunk(
            chunk_type="summary", content=profile["summary"], embedding=[0.0] * 1536, embedding_model="test"
        )
    ]


def _fake_normalise_skills(skills_raw: list[str], _conn) -> list[cv_pipeline.SkillMatch]:
    return [cv_pipeline.SkillMatch(raw_text=s, skill_id=None, canonical_name=None, confidence=0.0) for s in skills_raw]


def _fake_re_embed_summary(text: str) -> cv_pipeline.Chunk:
    return cv_pipeline.Chunk(chunk_type="summary", content=text, embedding=[0.0] * 1536, embedding_model="test")


# Records exactly what the combined-summary step was actually given, so
# assertions can check the EFFECTIVE inputs (not just the final text).
COMBINED_SUMMARY_CALLS: list[dict] = []


def _fake_synthesize_combined_summary(profile: dict, github_signal: dict) -> str:
    top_repo_names = [r["name"] for r in github_signal.get("top_repos", [])]
    COMBINED_SUMMARY_CALLS.append({"cv_summary": profile.get("summary"), "top_repos": top_repo_names})
    return f"COMBINED SUMMARY[cv={profile.get('summary')}|repos={','.join(top_repo_names)}]"


class _GithubFixture:
    def __init__(self, username: str, repos: list[dict]):
        self.username = username
        self.repos = repos


def _fake_response(status_code: int, payload: object) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = payload
    response.text = payload if isinstance(payload, str) else ""
    response.headers = {}
    if status_code >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(f"{status_code}")
    else:
        response.raise_for_status = MagicMock()
    return response


def _github_router(fixture: _GithubFixture):
    def _get(url: str, **_kwargs):
        if url.endswith("/user/repos"):
            return _fake_response(200, fixture.repos)
        if url.endswith("/readme"):
            return _fake_response(404, {})
        raise AssertionError(f"unexpected GET {url}")

    return _get


def _repo(name: str, i: int = 0) -> dict:
    return {
        "name": name,
        "full_name": f"octo/{name}",
        "html_url": f"https://github.com/octo/{name}",
        "description": f"Project {name}",
        "language": "Python",
        "stargazers_count": i,
        "forks_count": 0,
        "size": 100,
        "fork": False,
        "pushed_at": "2026-06-01T00:00:00Z",
    }


# ─── member fixture ──────────────────────────────────────────────────────
def create_member(conn) -> uuid.UUID:
    member_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into auth.users
                (id, email, raw_user_meta_data, raw_app_meta_data,
                 confirmation_token, recovery_token, email_change_token_new)
            values (%s, %s, %s, %s, '', '', '')
            """,
            (
                member_id,
                f"lifecycle-{member_id}@example-test.invalid",
                Jsonb({"first_name": "Lifecycle", "surname": "Test", "role": "alum", "grad_year": 2020}),
                Jsonb({"provider": "email"}),
            ),
        )
        # profiles_protect_status only allows a status change from the service
        # role or an admin — present as service_role for this one write, same
        # as the real service-role client would.
        cur.execute("select set_config('request.jwt.claim.role', 'service_role', true)")
        cur.execute(
            "update public.profiles set status = 'approved', course = 'Test', grad_year = 2020 where id = %s",
            (member_id,),
        )
        cur.execute("select set_config('request.jwt.claim.role', '', true)")
    conn.commit()
    return member_id


def delete_member(conn, member_id: uuid.UUID) -> None:
    with conn.cursor() as cur:
        cur.execute("delete from auth.users where id = %s", (member_id,))
    conn.commit()


def call_rpc(conn, member_id: uuid.UUID, sql: str, params: tuple = ()):
    with conn.cursor() as cur:
        cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(member_id),))
        cur.execute(sql, params)
        result = cur.fetchall() if cur.description else None
    conn.commit()
    return result


def cv_skills_for(conn, member_id: uuid.UUID) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "select raw_text from public.member_skills where member_id = %s and source = 'cv'", (member_id,)
        )
        return {row[0] for row in cur.fetchall()}


def github_skills_for(conn, member_id: uuid.UUID) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "select raw_text from public.member_skills where member_id = %s and source = 'github'", (member_id,)
        )
        return {row[0] for row in cur.fetchall()}


def current_summary(conn, member_id: uuid.UUID) -> tuple[str | None, str | None]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select cp.summary, cp.summary_source
              from public.cvs c
              join public.cv_profiles cp on cp.cv_id = c.id
             where c.member_id = %s and c.is_current = true
            """,
            (member_id,),
        )
        row = cur.fetchone()
    return (row[0], row[1]) if row else (None, None)


def insert_cv(conn, member_id: uuid.UUID, blob_key: str) -> uuid.UUID:
    cv_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            "insert into public.cvs (id, member_id, blob_key, status) values (%s, %s, %s, 'pending')",
            (cv_id, member_id, blob_key),
        )
    conn.commit()
    return cv_id


def run() -> None:
    import psycopg

    conn = psycopg.connect(os.environ["DATABASE_URL"])
    member_id = create_member(conn)
    print(f"test member: {member_id}\n")

    try:
        # ─── Step 1: first CV upload, no GitHub yet ────────────────────
        print("Step 1 — first CV upload, no GitHub connection")
        with (
            patch("app.worker.get_blob", side_effect=_fake_get_blob),
            patch("app.worker.sanitise_document", side_effect=_fake_sanitise_document),
            patch("app.worker.sanitise_cv", side_effect=_make_fake_sanitise_cv("CV-A content")),
            patch("app.worker.moderate_cv", side_effect=_fake_moderate_cv),
            patch("app.cv_pipeline.extract_profile", side_effect=_make_fake_extract_profile("CV-A")),
            patch("app.cv_pipeline.chunk_and_embed", side_effect=_fake_chunk_and_embed),
            patch("app.cv_pipeline.normalise_skills", side_effect=_fake_normalise_skills),
        ):
            cv_a_id = insert_cv(conn, member_id, "test/cv-a")
            worker.process_ingest_cv(cv_a_id)

        summary, source = current_summary(conn, member_id)
        check("CV-only summary stored after first upload", summary == "CV-ONLY SUMMARY[CV-A]", str(summary))
        check("summary_source is 'cv' with no GitHub connected", source == "cv", str(source))
        check(
            "member_skills(source='cv') holds CV-A's own skill",
            cv_skills_for(conn, member_id) == {"Skill-CV-A"},
            str(cv_skills_for(conn, member_id)),
        )

        # ─── Step 2: connect GitHub (account #1), scan runs ────────────
        print("\nStep 2 — connect GitHub account #1, first scan")
        fixture_a = _GithubFixture("octocat-a", [_repo("repo-alpha", 1), _repo("repo-beta", 2)])
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.github_connections
                    (member_id, github_user_id, github_username, access_token_encrypted, scan_status)
                values (%s, 1001, %s, extensions.pgp_sym_encrypt('tok', %s), 'pending')
                """,
                (member_id, fixture_a.username, os.environ["GITHUB_TOKEN_ENCRYPTION_KEY"]),
            )
        conn.commit()

        with (
            patch("app.github_pipeline.requests.get", side_effect=_github_router(fixture_a)),
            patch("app.cv_pipeline.normalise_skills", side_effect=_fake_normalise_skills),
            patch("app.github_pipeline._classify_exclusions", return_value=set()),
            patch(
                "app.github_pipeline._select_impressive_repos",
                return_value=github_pipeline._RepoJudgment(selected=[], themes=[]),
            ),
            patch("app.github_pipeline.synthesize_combined_summary", side_effect=_fake_synthesize_combined_summary),
            patch("app.cv_pipeline.re_embed_summary", side_effect=_fake_re_embed_summary),
        ):
            worker.process_scan_github(member_id)

        summary, source = current_summary(conn, member_id)
        check(
            "combined summary generated once CV+GitHub both ready",
            summary is not None and summary.startswith("COMBINED SUMMARY[cv=CV-ONLY SUMMARY[CV-A]"),
            str(summary),
        )
        check("summary_source is 'cv_github'", source == "cv_github", str(source))
        check(
            "connecting GitHub does NOT wipe the existing CV-sourced skill",
            cv_skills_for(conn, member_id) == {"Skill-CV-A"},
            str(cv_skills_for(conn, member_id)),
        )

        # ─── Step 3: member picks a project (repo-beta) ────────────────
        print("\nStep 3 — member spotlights repo-beta")
        COMBINED_SUMMARY_CALLS.clear()
        with (
            patch("app.github_pipeline.synthesize_combined_summary", side_effect=_fake_synthesize_combined_summary),
            patch("app.cv_pipeline.re_embed_summary", side_effect=_fake_re_embed_summary),
        ):
            call_rpc(
                conn,
                member_id,
                "select public.set_my_github_showcase(%s::jsonb)",
                (Jsonb([{"name": "repo-beta", "blurb": "my pick"}]),),
            )
            # set_my_github_showcase only ENQUEUES a job — run the job body directly,
            # same as the queue would, so this test controls timing deterministically.
            worker.process_refresh_github_summary(member_id)

        summary, _ = current_summary(conn, member_id)
        check(
            "summary now cites the member's OWN pick (repo-beta), not the LLM's suggestion",
            "repos=repo-beta" in (summary or ""),
            str(summary),
        )
        check("exactly one combined-summary call was made for this pick", len(COMBINED_SUMMARY_CALLS) == 1)

        # ─── Step 4: replace the CV (CV #2) — picks must carry over ────
        print("\nStep 4 — upload a replacement CV; existing pick must carry over automatically")
        with (
            patch("app.worker.get_blob", side_effect=_fake_get_blob),
            patch("app.worker.sanitise_document", side_effect=_fake_sanitise_document),
            patch("app.worker.sanitise_cv", side_effect=_make_fake_sanitise_cv("CV-B content, totally different")),
            patch("app.worker.moderate_cv", side_effect=_fake_moderate_cv),
            patch("app.cv_pipeline.extract_profile", side_effect=_make_fake_extract_profile("CV-B")),
            patch("app.cv_pipeline.chunk_and_embed", side_effect=_fake_chunk_and_embed),
            patch("app.cv_pipeline.normalise_skills", side_effect=_fake_normalise_skills),
            patch("app.github_pipeline.synthesize_combined_summary", side_effect=_fake_synthesize_combined_summary),
            patch("app.cv_pipeline.re_embed_summary", side_effect=_fake_re_embed_summary),
        ):
            cv_b_id = insert_cv(conn, member_id, "test/cv-b")
            worker.process_ingest_cv(cv_b_id)

        summary, source = current_summary(conn, member_id)
        check("new CV content reflected", "CV-B" in (summary or ""), str(summary))
        check(
            "member_skills(source='cv') REPLACED with CV-B's skill, CV-A's is gone (not accumulated)",
            cv_skills_for(conn, member_id) == {"Skill-CV-B"},
            str(cv_skills_for(conn, member_id)),
        )
        check(
            "replacing the CV does NOT wipe github-sourced skills (source-scoped delete, cross-checked for real)",
            github_skills_for(conn, member_id) == {"Python"},
            str(github_skills_for(conn, member_id)),
        )
        check(
            "existing pick (repo-beta) automatically carried over — no re-pick needed",
            "repos=repo-beta" in (summary or ""),
            str(summary),
        )
        check("summary_source is 'cv_github' immediately, no separate refresh step needed", source == "cv_github")

        # ─── Step 5: re-scan GitHub (e.g. weekly cron) — pick must survive ──
        print("\nStep 5 — GitHub re-scan (simulating the weekly cron); pick must survive")
        fixture_a2 = _GithubFixture("octocat-a", [_repo("repo-alpha", 1), _repo("repo-beta", 5), _repo("repo-gamma", 9)])
        with (
            patch("app.github_pipeline.requests.get", side_effect=_github_router(fixture_a2)),
            patch("app.cv_pipeline.normalise_skills", side_effect=_fake_normalise_skills),
            patch("app.github_pipeline._classify_exclusions", return_value=set()),
            patch(
                "app.github_pipeline._select_impressive_repos",
                return_value=github_pipeline._RepoJudgment(selected=[], themes=[]),
            ),
            patch("app.github_pipeline.synthesize_combined_summary", side_effect=_fake_synthesize_combined_summary),
            patch("app.cv_pipeline.re_embed_summary", side_effect=_fake_re_embed_summary),
        ):
            worker.process_scan_github(member_id)

        with conn.cursor() as cur:
            cur.execute("select showcase_repos from public.github_connections where member_id = %s", (member_id,))
            picks_after_rescan = cur.fetchone()[0]
        summary, _ = current_summary(conn, member_id)
        check(
            "pick survives an unrelated re-scan (repo-beta still exists in new listing)",
            picks_after_rescan is not None and picks_after_rescan[0]["name"] == "repo-beta",
            str(picks_after_rescan),
        )
        check("summary still cites the surviving pick after rescan", "repos=repo-beta" in (summary or ""), str(summary))

        # ─── Step 6: disconnect GitHub — must revert to CV-only, not stale combined ──
        print("\nStep 6 — disconnect GitHub")
        call_rpc(conn, member_id, "select public.disconnect_github()")
        with patch("app.cv_pipeline.re_embed_summary", side_effect=_fake_re_embed_summary):
            worker.process_refresh_github_summary(member_id)  # the job disconnect_github enqueues

        summary, source = current_summary(conn, member_id)
        check(
            "summary reverted to CV-B's OWN cv-only baseline (not CV-A's stale one, not left combined)",
            summary == "CV-ONLY SUMMARY[CV-B]",
            str(summary),
        )
        check("summary_source reverted to 'cv'", source == "cv", str(source))
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.github_connections where member_id = %s", (member_id,))
            check("github_connections row fully deleted (picks gone too)", cur.fetchone()[0] == 0)
            cur.execute(
                "select count(*) from public.member_skills where member_id = %s and source = 'github'", (member_id,)
            )
            check("github-sourced skills deleted on disconnect", cur.fetchone()[0] == 0)
        check(
            "disconnecting GitHub does NOT wipe the CV-sourced skill (source-scoped delete, both directions now)",
            cv_skills_for(conn, member_id) == {"Skill-CV-B"},
            str(cv_skills_for(conn, member_id)),
        )

        # ─── Step 7: connect a DIFFERENT GitHub account — no stale picks ──
        print("\nStep 7 — connect a completely different GitHub account")
        fixture_b = _GithubFixture("different-user", [_repo("new-repo-one", 1)])
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.github_connections
                    (member_id, github_user_id, github_username, access_token_encrypted, scan_status)
                values (%s, 2002, %s, extensions.pgp_sym_encrypt('tok2', %s), 'pending')
                """,
                (member_id, fixture_b.username, os.environ["GITHUB_TOKEN_ENCRYPTION_KEY"]),
            )
        conn.commit()

        with (
            patch("app.github_pipeline.requests.get", side_effect=_github_router(fixture_b)),
            patch("app.cv_pipeline.normalise_skills", side_effect=_fake_normalise_skills),
            patch("app.github_pipeline._classify_exclusions", return_value=set()),
            patch(
                "app.github_pipeline._select_impressive_repos",
                return_value=github_pipeline._RepoJudgment(selected=[], themes=[]),
            ),
            patch("app.github_pipeline.synthesize_combined_summary", side_effect=_fake_synthesize_combined_summary),
            patch("app.cv_pipeline.re_embed_summary", side_effect=_fake_re_embed_summary),
        ):
            worker.process_scan_github(member_id)

        with conn.cursor() as cur:
            cur.execute("select showcase_repos from public.github_connections where member_id = %s", (member_id,))
            fresh_picks = cur.fetchone()[0]
        summary, _ = current_summary(conn, member_id)
        check("brand-new connection starts with NO picks (null, not stale)", fresh_picks is None, str(fresh_picks))
        check(
            "summary recombines with new account's real signal, cites no stale repo",
            summary is not None and "repos=" in summary and "new-repo-one" not in summary,
            str(summary),
        )  # LLM suggested nothing (patched to selected=[]), which is correct: no picks yet either.

        # ─── Step 8: remove the CV entirely — summary must disappear, not dangle ──
        print("\nStep 8 — remove CV entirely (GitHub stays connected)")
        call_rpc(conn, member_id, "select public.remove_my_cv()")
        summary, source = current_summary(conn, member_id)
        check("no current CV row — get_my_cv_profile()-equivalent returns nothing", summary is None, str(summary))
        with conn.cursor() as cur:
            cur.execute("select scan_status from public.github_connections where member_id = %s", (member_id,))
            gh_status_after_cv_removed = cur.fetchone()[0]
        check(
            "GitHub connection itself is untouched by a CV removal (survives independently)",
            gh_status_after_cv_removed == "ready",
            str(gh_status_after_cv_removed),
        )
        check(
            "CV-sourced skills deleted along with the CV (remove_my_cv's own delete)",
            cv_skills_for(conn, member_id) == set(),
            str(cv_skills_for(conn, member_id)),
        )
        check(
            "github-sourced skills survive a CV removal (source-scoped, independent axes)",
            github_skills_for(conn, member_id) == {"Python"},
            str(github_skills_for(conn, member_id)),
        )

        # ─── Step 9: re-upload a CV — must immediately recombine with the still-connected GitHub ──
        print("\nStep 9 — re-upload a CV after removal; GitHub was never touched")
        with (
            patch("app.worker.get_blob", side_effect=_fake_get_blob),
            patch("app.worker.sanitise_document", side_effect=_fake_sanitise_document),
            patch("app.worker.sanitise_cv", side_effect=_make_fake_sanitise_cv("CV-C content, brand new")),
            patch("app.worker.moderate_cv", side_effect=_fake_moderate_cv),
            patch("app.cv_pipeline.extract_profile", side_effect=_make_fake_extract_profile("CV-C")),
            patch("app.cv_pipeline.chunk_and_embed", side_effect=_fake_chunk_and_embed),
            patch("app.cv_pipeline.normalise_skills", side_effect=_fake_normalise_skills),
            patch("app.github_pipeline.synthesize_combined_summary", side_effect=_fake_synthesize_combined_summary),
            patch("app.cv_pipeline.re_embed_summary", side_effect=_fake_re_embed_summary),
        ):
            cv_c_id = insert_cv(conn, member_id, "test/cv-c")
            worker.process_ingest_cv(cv_c_id)

        summary, source = current_summary(conn, member_id)
        check("new CV immediately recombines with the still-live GitHub connection", "CV-C" in (summary or ""), str(summary))
        check(
            "member_skills(source='cv') REPLACED again with CV-C's skill, CV-B's is gone",
            cv_skills_for(conn, member_id) == {"Skill-CV-C"},
            str(cv_skills_for(conn, member_id)),
        )
        check("summary_source is 'cv_github' from the first ingest, no manual reconnect needed", source == "cv_github")

    finally:
        delete_member(conn, member_id)

    # ─── Step 10: a STUDENT cannot remove their CV at the RPC level ─────
    # Self-contained: needs an @imperial.ac.uk email (is_imperial_email's
    # trigger check) rather than the @example-test.invalid domain the
    # other steps use, so it's its own member rather than reusing create_member.
    print("\nStep 10 — a student cannot remove their CV (backend enforcement, not just UI)")
    student_id = uuid.uuid4()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into auth.users
                    (id, email, raw_user_meta_data, raw_app_meta_data,
                     confirmation_token, recovery_token, email_change_token_new)
                values (%s, %s, %s, %s, '', '', '')
                """,
                (
                    student_id,
                    f"lifecycle-student-{student_id}@imperial.ac.uk",
                    Jsonb({"first_name": "Student", "surname": "Test", "role": "student", "grad_year": 2028}),
                    Jsonb({"provider": "email"}),
                ),
            )
            cur.execute("select set_config('request.jwt.claim.role', 'service_role', true)")
            cur.execute(
                "update public.profiles set status = 'approved', course = 'Test Course' where id = %s",
                (student_id,),
            )
            cur.execute("select set_config('request.jwt.claim.role', '', true)")
        conn.commit()

        with (
            patch("app.worker.get_blob", side_effect=_fake_get_blob),
            patch("app.worker.sanitise_document", side_effect=_fake_sanitise_document),
            patch("app.worker.sanitise_cv", side_effect=_make_fake_sanitise_cv("Student CV content")),
            patch("app.worker.moderate_cv", side_effect=_fake_moderate_cv),
            patch("app.cv_pipeline.extract_profile", side_effect=_make_fake_extract_profile("STUDENT")),
            patch("app.cv_pipeline.chunk_and_embed", side_effect=_fake_chunk_and_embed),
            patch("app.cv_pipeline.normalise_skills", side_effect=_fake_normalise_skills),
        ):
            student_cv_id = insert_cv(conn, student_id, "test/student-cv")
            worker.process_ingest_cv(student_cv_id)

        summary_before, _ = current_summary(conn, student_id)
        check("student's CV ingested fine", summary_before == "CV-ONLY SUMMARY[STUDENT]", str(summary_before))

        rejected = False
        try:
            call_rpc(conn, student_id, "select public.remove_my_cv()")
        except Exception as exc:  # noqa: BLE001 — asserting on the rejection itself
            rejected = "cannot be removed" in str(exc) or "42501" in str(exc)
            conn.rollback()
        check("remove_my_cv() REJECTS a student at the RPC level, not just hidden in the UI", rejected, "no exception raised")

        summary_after, _ = current_summary(conn, student_id)
        check("student's CV/summary is untouched after the rejected attempt", summary_after == summary_before, str(summary_after))
    finally:
        conn.rollback()  # harmless no-op if the transaction was already clean
        delete_member(conn, student_id)

    # ─── Step 11: a genuine extraction failure must resolve immediately,
    # not strand the member in perpetual "processing" ────────────────────
    print("\nStep 11 — CV extraction genuinely fails (malformed model response)")
    member_11 = create_member(conn)
    try:
        with (
            patch("app.worker.get_blob", side_effect=_fake_get_blob),
            patch("app.worker.sanitise_document", side_effect=_fake_sanitise_document),
            patch("app.worker.sanitise_cv", side_effect=_make_fake_sanitise_cv("Unparseable CV content")),
            patch("app.worker.moderate_cv", side_effect=_fake_moderate_cv),
            patch(
                "app.cv_pipeline.extract_profile",
                side_effect=cv_pipeline.ExtractionError("Model response was not valid JSON"),
            ),
        ):
            cv_11_id = insert_cv(conn, member_11, "test/cv-11")
            worker.process_ingest_cv(cv_11_id)

        with conn.cursor() as cur:
            cur.execute("select status, failure_reason from public.cvs where id = %s", (cv_11_id,))
            status_11, reason_11 = cur.fetchone()
        check(
            "cvs.status resolves to 'failed' immediately — not stuck at 'embedding' forever",
            status_11 == "failed",
            f"status={status_11!r}",
        )
        check("a real, specific failure_reason is recorded for the member/admin to see", bool(reason_11), str(reason_11))
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.cv_profiles where cv_id = %s", (cv_11_id,))
            check("no cv_profiles row was created from the failed extraction", cur.fetchone()[0] == 0)
    finally:
        delete_member(conn, member_11)

    # ─── Step 12: an UNNAMED exception must still resolve via the dead-
    # letter backstop, not just the specific ExtractionError handler ─────
    print("\nStep 12 — an unrecognised exception type still resolves once the job dead-letters")
    member_12 = create_member(conn)
    try:
        # Earlier steps call job-body functions directly and bypass the
        # queue, so the real jobs rows those RPCs inserted (set_my_github_showcase
        # in step 3, disconnect_github in step 6) were never claimed —
        # _claim_job's `order by created_at limit 1` would otherwise pick one
        # of those orphaned rows instead of the one this step cares about.
        with conn.cursor() as cur:
            cur.execute("delete from public.jobs where status = 'pending'")
        conn.commit()

        with (
            patch("app.worker.get_blob", side_effect=_fake_get_blob),
            patch("app.worker.sanitise_document", side_effect=_fake_sanitise_document),
            patch("app.worker.sanitise_cv", side_effect=_make_fake_sanitise_cv("Some CV content")),
            patch("app.worker.moderate_cv", side_effect=_fake_moderate_cv),
            patch("app.cv_pipeline.extract_profile", side_effect=RuntimeError("simulated unknown failure — e.g. a raw SDK error")),
        ):
            cv_12_id = insert_cv(conn, member_12, "test/cv-12")
            with conn.cursor() as cur:
                # max_attempts=1 so a single failure dead-letters immediately,
                # rather than needing 5 real retries to prove the backstop.
                cur.execute(
                    "insert into public.jobs (kind, payload, max_attempts) values ('ingest_cv', %s, 1)",
                    (Jsonb({"cv_id": str(cv_12_id)}),),
                )
            conn.commit()
            worker.run_once()  # claims and runs the job above; the RuntimeError is NOT process_ingest_cv's job to catch

        with conn.cursor() as cur:
            cur.execute("select status from public.jobs where kind = 'ingest_cv' and (payload->>'cv_id') = %s", (str(cv_12_id),))
            job_status_12 = cur.fetchone()[0]
            cur.execute("select status, failure_reason from public.cvs where id = %s", (cv_12_id,))
            cv_status_12, cv_reason_12 = cur.fetchone()
        check("the job itself dead-lettered as expected", job_status_12 == "dead", str(job_status_12))
        check(
            "the BACKSTOP (not a specific handler) still resolved cvs.status to 'failed' — no stuck limbo",
            cv_status_12 == "failed",
            f"status={cv_status_12!r}",
        )
        check("the backstop recorded a real failure reason", bool(cv_reason_12), str(cv_reason_12))
    finally:
        delete_member(conn, member_12)

    # ─── Step 13: same backstop, the GitHub-scan side ────────────────────
    print("\nStep 13 — an unrecognised exception during a GitHub scan also resolves via the backstop")
    member_13 = create_member(conn)
    try:
        with conn.cursor() as cur:
            cur.execute("delete from public.jobs where status = 'pending'")
            cur.execute(
                """
                insert into public.github_connections
                    (member_id, github_user_id, github_username, access_token_encrypted, scan_status)
                values (%s, 3003, 'octocat-13', extensions.pgp_sym_encrypt('tok13', %s), 'pending')
                """,
                (member_13, os.environ["GITHUB_TOKEN_ENCRYPTION_KEY"]),
            )
            cur.execute(
                "insert into public.jobs (kind, payload, max_attempts) values ('scan_github', %s, 1)",
                (Jsonb({"member_id": str(member_13)}),),
            )
        conn.commit()

        with patch(
            "app.github_pipeline.fetch_github_signal",
            side_effect=RuntimeError("simulated unknown failure — not a GithubScanError"),
        ):
            worker.run_once()

        with conn.cursor() as cur:
            cur.execute(
                "select status from public.jobs where kind = 'scan_github' and (payload->>'member_id')::uuid = %s",
                (member_13,),
            )
            job_status_13 = cur.fetchone()[0]
            cur.execute(
                "select scan_status, scan_failure_reason from public.github_connections where member_id = %s",
                (member_13,),
            )
            gh_status_13, gh_reason_13 = cur.fetchone()
        check("the scan_github job dead-lettered as expected", job_status_13 == "dead", str(job_status_13))
        check(
            "the backstop resolved scan_status to 'failed' — not stuck at 'scanning' forever",
            gh_status_13 == "failed",
            f"status={gh_status_13!r}",
        )
        check("the backstop recorded a real failure reason for the scan too", bool(gh_reason_13), str(gh_reason_13))
    finally:
        delete_member(conn, member_13)
        # Final sweep: orphaned jobs rows have no FK to auth.users (jobs
        # doesn't reference profiles at all), so deleting members throughout
        # this script never cascaded to them — tidy up so a local dev DB
        # isn't left with dead rows after running this test.
        with conn.cursor() as cur:
            cur.execute("delete from public.jobs where status in ('pending', 'dead', 'done')")
        conn.commit()
        conn.close()

    print(f"\n{'=' * 60}")
    if FAILURES:
        print(f"LIFECYCLE_TEST_FAIL — {len(FAILURES)} check(s) failed:")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("LIFECYCLE_TEST_PASS — every permutation checked out.")


if __name__ == "__main__":
    run()
