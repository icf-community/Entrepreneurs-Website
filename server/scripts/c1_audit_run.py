#!/usr/bin/env python3
"""C1 generalisation audit — runner.

Runs the 26-profile synthetic corpus (tests/fixtures/c1_audit/profiles.py)
through the REAL cv_sanitise / cv_pipeline / github_pipeline functions —
real LLM calls, real embeddings, real local-Supabase skill matching. No
pipeline source file is imported for modification and none is touched;
this script only calls the public functions those modules already export.

GitHub is the one thing that must never make a real network call: exactly
like tests/test_github_pipeline.py, `requests.get` is monkeypatched with a
URL-routing stub built from each profile's synthetic fixture. The OpenAI
client is NOT mocked — that's the entire point of this audit.

Usage (from server/, with the venv active and local Supabase running):

    python scripts/c1_audit_run.py [--out DIR] [--only ID[,ID...]]

Requires DATABASE_URL (local Supabase, port 54322) and OPENAI_API_KEY —
loaded from server/.env.worker.local if not already set in the
environment. See ~/.claude/plans/velvety-weaving-dijkstra.md, "PART C —
C1" and docs/audits/C1-generalisation-findings.md for the audit this
feeds.

Raw per-profile output is written as JSON to --out (default: a scratch
dir outside the repo) for manual rubric grading — this script does not
grade; it only runs the pipeline and records a few mechanically-checkable
facts (exceptions raised, whether the two-pass shortlist triggered,
skill_id=NULL fractions, the #25 dedup count).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from dotenv import dotenv_values  # noqa: E402

_env_file = SERVER_ROOT / ".env.worker.local"
if _env_file.exists():
    for key, value in dotenv_values(_env_file).items():
        if value is not None:
            import os

            os.environ.setdefault(key, value)

from psycopg.types.json import Jsonb  # noqa: E402

from app import cv_pipeline, github_pipeline  # noqa: E402
from app.cv_sanitise import (  # noqa: E402
    DOCX_CONTENT_TYPE,
    PDF_CONTENT_TYPE,
    ExtractionFailed,
    sanitise_cv,
)
from app.db import connection  # noqa: E402
from app.openai_client import client as get_openai_client  # noqa: E402
from app.worker import _replace_member_skills  # noqa: E402

from tests.fixtures.c1_audit import render  # noqa: E402
from tests.fixtures.c1_audit.profiles import ALL_PROFILES, GithubFixture, Profile  # noqa: E402


# ─── usage tracking (instrumentation only — wraps the returned client's
# bound methods at runtime; does not touch app/openai_client.py) ────────
_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "calls": 0}


def _install_usage_tracking() -> None:
    real_client = get_openai_client()
    orig_chat_create = real_client.chat.completions.create
    orig_embed_create = real_client.embeddings.create

    def tracked_chat_create(*args, **kwargs):
        response = orig_chat_create(*args, **kwargs)
        usage = getattr(response, "usage", None)
        if usage is not None:
            _usage["prompt_tokens"] += usage.prompt_tokens
            _usage["completion_tokens"] += usage.completion_tokens
            _usage["total_tokens"] += usage.total_tokens
        _usage["calls"] += 1
        return response

    def tracked_embed_create(*args, **kwargs):
        response = orig_embed_create(*args, **kwargs)
        usage = getattr(response, "usage", None)
        if usage is not None:
            _usage["prompt_tokens"] += usage.prompt_tokens
            _usage["total_tokens"] += usage.total_tokens
        _usage["calls"] += 1
        return response

    real_client.chat.completions.create = tracked_chat_create
    real_client.embeddings.create = tracked_embed_create


# ─── GitHub HTTP stubbing — same shape as test_github_pipeline.py's
# `_fake_response` / `_get` router (see its lines ~79-108, ~302-309) ────
def _fake_response(status_code: int, payload: object, headers: dict | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = payload
    response.text = payload if isinstance(payload, str) else json.dumps(payload)
    response.headers = headers or {}
    if status_code >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(f"{status_code} error")
    else:
        response.raise_for_status = MagicMock()
    return response


def _make_get_router(fixture: GithubFixture):
    repos_prefix = f"{github_pipeline.GITHUB_API}/repos/"

    def _get(url: str, **kwargs):
        if url.endswith("/user/repos"):
            page = (kwargs.get("params") or {}).get("page", 1)
            start = (page - 1) * github_pipeline.PER_PAGE
            batch = fixture.repos[start : start + github_pipeline.PER_PAGE]
            return _fake_response(200, batch)
        if url.endswith("/readme") and url.startswith(repos_prefix):
            full_name = url[len(repos_prefix) : -len("/readme")]
            if full_name == f"{fixture.username}/{fixture.username}":
                if fixture.profile_readme is not None:
                    return _fake_response(200, fixture.profile_readme)
                return _fake_response(404, {})
            if full_name in fixture.readmes:
                return _fake_response(200, fixture.readmes[full_name])
            return _fake_response(404, {})
        raise AssertionError(f"unexpected GET {url}")

    return _get


# ─── mirrors worker.py's _apply_effective_showcase (server/app/worker.py,
# lines ~365-404) exactly — same field mapping, same "no picks -> pass
# github_signal through unchanged" behaviour. Reimplemented rather than
# imported because the real function reads picks from a DB column keyed
# by member_id; this harness already has the picks as fixture data, so a
# live DB round trip buys nothing for this one pure reshaping step. The
# judgment this audit actually cares about — synthesize_combined_summary
# — still runs through the real, unmodified github_pipeline.py function.
def _apply_effective_showcase_mirror(github_signal: dict, picks: list[dict] | None) -> dict:
    if not picks:
        return github_signal
    return {
        **github_signal,
        "top_repos": [
            {
                "name": pick.get("name"),
                "description": pick.get("blurb") or pick.get("description"),
                "language": pick.get("language"),
                "stargazers_count": pick.get("stargazers_count", 0),
                "url": pick.get("url"),
            }
            for pick in picks
        ],
    }


def _render_cv_bytes(profile: Profile) -> tuple[bytes, str]:
    if profile.cv_render == "pdf_1col":
        return render.render_pdf_1col(profile.cv_text), PDF_CONTENT_TYPE
    if profile.cv_render == "pdf_2col":
        return render.render_pdf_2col_multipage(profile.cv_text), PDF_CONTENT_TYPE
    if profile.cv_render == "pdf_scanned":
        return render.render_pdf_scanned_image(profile.cv_text), PDF_CONTENT_TYPE
    if profile.cv_render == "docx":
        return render.render_docx(profile.cv_text), DOCX_CONTENT_TYPE
    raise ValueError(f"unknown cv_render: {profile.cv_render!r}")


def _serialise_skill_matches(matches: list[cv_pipeline.SkillMatch]) -> list[dict]:
    return [
        {
            "raw_text": m.raw_text,
            "canonical_name": m.canonical_name,
            "confidence": m.confidence,
            "matched": m.skill_id is not None,
        }
        for m in matches
    ]


def run_profile(profile: Profile, conn) -> tuple[dict, dict]:
    """Returns (json_result, internal) — internal carries live Python
    objects (skill matches, extracted profile dict) that a couple of
    profiles' special-case follow-ups need (see run_python_dedup_check
    for #25) and that don't belong in the saved JSON."""
    result: dict = {"id": profile.id, "slug": profile.slug, "description": profile.description}
    internal: dict = {}

    # ─── CV half ───
    cv_profile_dict: dict | None = None
    cv_summary: str | None = None
    cv_skill_matches: list[cv_pipeline.SkillMatch] = []

    if profile.cv_render is None:
        result["cv"] = {"skipped": True, "reason": profile.notes.get("reason", "no CV uploaded")}
    else:
        cv_bytes, content_type = _render_cv_bytes(profile)
        try:
            sanitised = sanitise_cv(cv_bytes, content_type)
        except ExtractionFailed as exc:
            result["cv"] = {"extraction_failed": True, "message": str(exc)}
        else:
            result["cv_sanitise"] = {
                "flagged": sanitised.flagged,
                "flag_reasons": sanitised.flag_reasons,
                "extracted_chars": len(sanitised.raw_text),
            }
            extraction = cv_pipeline.extract_profile(sanitised.raw_text)
            cv_profile_dict = extraction.profile
            cv_summary = extraction.summary
            cv_skill_matches = cv_pipeline.normalise_skills(extraction.profile.get("skills_raw", []), conn)
            chunks = cv_pipeline.chunk_and_embed(extraction.profile)

            result["cv_extraction"] = {
                "profile": extraction.profile,
                "summary": extraction.summary,
                "model_name": extraction.model_name,
                "prompt_version": extraction.prompt_version,
            }
            result["skill_matches"] = _serialise_skill_matches(cv_skill_matches)
            result["skill_id_null_fraction"] = (
                sum(1 for m in cv_skill_matches if m.skill_id is None) / len(cv_skill_matches)
                if cv_skill_matches
                else None
            )
            result["chunk_count"] = len(chunks)

    # ─── GitHub half ───
    github_skill_matches: list[cv_pipeline.SkillMatch] = []
    if profile.github is not None:
        router = _make_get_router(profile.github)
        shortlist_calls: list[int] = []
        real_shortlist = github_pipeline._shortlist_by_metadata

        def _tracked_shortlist(candidates):
            shortlist_calls.append(len(candidates))
            return real_shortlist(candidates)

        with (
            patch("app.github_pipeline.requests.get", side_effect=router),
            patch("app.github_pipeline._shortlist_by_metadata", side_effect=_tracked_shortlist),
        ):
            try:
                signal = github_pipeline.fetch_github_signal(
                    "fake-audit-token", profile.github.username
                )
                github_error = None
            except Exception as exc:  # noqa: BLE001 — recorded, not swallowed
                signal = None
                github_error = {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()}

        result["github_error"] = github_error
        result["two_pass_shortlist_triggered"] = bool(shortlist_calls)
        result["shortlist_input_candidate_count"] = shortlist_calls[0] if shortlist_calls else None

        if signal is not None:
            result["github_repo_count"] = signal.repo_count
            result["github_available_repos_count"] = len(signal.available_repos)
            result["github_languages"] = signal.languages
            result["github_themes"] = signal.themes
            result["github_llm_top_repos"] = signal.top_repos
            result["github_available_repo_names"] = [r["name"] for r in signal.available_repos]

            github_skill_matches = cv_pipeline.normalise_skills(signal.languages, conn)
            result["github_skill_matches"] = _serialise_skill_matches(github_skill_matches)

            github_signal_dict = signal.as_signal_dict()
            effective_signal = _apply_effective_showcase_mirror(github_signal_dict, profile.showcase_picks)
            result["effective_top_repos"] = effective_signal["top_repos"]
            result["showcase_picks_applied"] = profile.showcase_picks
            result["showcase_dismissed"] = profile.showcase_dismissed

            if cv_profile_dict is not None:
                try:
                    combined_summary = github_pipeline.synthesize_combined_summary(
                        cv_profile_dict, effective_signal
                    )
                    result["combined_summary"] = combined_summary
                except Exception as exc:  # noqa: BLE001
                    result["combined_summary_error"] = {
                        "type": type(exc).__name__,
                        "message": str(exc),
                        "traceback": traceback.format_exc(),
                    }

    internal["cv_profile_dict"] = cv_profile_dict
    internal["cv_summary"] = cv_summary
    internal["cv_skill_matches"] = cv_skill_matches
    internal["github_skill_matches"] = github_skill_matches
    return result, internal


# ─── #25's DB half: cross-source Python dedup, via the real
# get_my_cv_profile() RPC (not a reimplementation of its SQL) against a
# single throwaway member created and torn down in this function. ───────
def run_python_dedup_check(conn, internal: dict) -> dict:
    member_id = uuid.uuid4()
    cv_id = uuid.uuid4()
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
                    member_id,
                    f"c1audit-{member_id}@example-audit.invalid",
                    # role='alum' (not 'student') sidesteps the new-user trigger's
                    # is_imperial_email() domain check — this member is a
                    # throwaway fixture, not a real @imperial.ac.uk account.
                    Jsonb({"first_name": "C1", "surname": "Audit", "role": "alum", "grad_year": 2020}),
                    Jsonb({"provider": "email"}),
                ),
            )
            # Left at the trigger's default status ('pending_onboarding') and
            # without `course` deliberately — get_my_cv_profile() (what this
            # check actually exercises) reads only cvs/cv_profiles/
            # member_skills, and pushing this throwaway row to 'approved'
            # would need to go through tg_profiles_protect_status, which is
            # real product behaviour this harness has no business bypassing.
            cur.execute(
                """
                insert into public.profiles (id, role, first_name, surname, grad_year)
                values (%s, 'alum', 'C1', 'Audit', 2020)
                on conflict (id) do nothing
                """,
                (member_id,),
            )
            cur.execute(
                """
                insert into public.cvs (id, member_id, blob_key, status, is_current)
                values (%s, %s, 'c1-audit/fake-blob-key', 'ready', true)
                """,
                (cv_id, member_id),
            )
            cur.execute(
                """
                insert into public.cv_profiles (cv_id, is_current, profile, summary, model_name, prompt_version)
                values (%s, true, %s, %s, %s, %s)
                """,
                (
                    cv_id,
                    Jsonb(internal["cv_profile_dict"]),
                    internal["cv_summary"],
                    cv_pipeline.EXTRACTION_MODEL,
                    cv_pipeline.EXTRACTION_PROMPT_VERSION,
                ),
            )
        _replace_member_skills(conn, member_id, internal["cv_skill_matches"], source="cv")
        _replace_member_skills(conn, member_id, internal["github_skill_matches"], source="github")

        with conn.cursor() as cur:
            cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(member_id),))
            cur.execute("select summary, skills from public.get_my_cv_profile()")
            row = cur.fetchone()

        skills = list(row[1]) if row and row[1] else []
        python_hits = [s for s in skills if s.strip().lower() == "python"]
        conn.commit()
        return {
            "skills_returned": skills,
            "python_occurrences": len(python_hits),
            "exactly_one_python": len(python_hits) == 1,
        }
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        return {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (member_id,))
        conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=None, help="output directory for per-profile JSON")
    parser.add_argument("--only", default=None, help="comma-separated profile ids to run, e.g. 8,19,20")
    args = parser.parse_args()

    out_dir = Path(args.out) if args.out else Path(
        "/private/tmp/claude-501/-Users-varunnayak-Downloads-EntrepreneursWebsite/"
        "d7cb80a2-85e3-4a07-9169-31078533b775/scratchpad/c1_audit_results"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    only_ids = {int(x) for x in args.only.split(",")} if args.only else None
    profiles = [p for p in ALL_PROFILES if only_ids is None or p.id in only_ids]

    _install_usage_tracking()

    started = time.time()
    with connection() as conn:
        for profile in profiles:
            t0 = time.time()
            print(f"[{profile.id:02d}/{len(ALL_PROFILES)}] {profile.slug} ...", flush=True)
            try:
                result, internal = run_profile(profile, conn)
                conn.commit()  # normalise_skills does no writes, but keep the txn short-lived
            except Exception as exc:  # noqa: BLE001 — one bad profile must not kill the run
                conn.rollback()
                result = {
                    "id": profile.id,
                    "slug": profile.slug,
                    "description": profile.description,
                    "unhandled_exception": {
                        "type": type(exc).__name__,
                        "message": str(exc),
                        "traceback": traceback.format_exc(),
                    },
                }
                internal = {}

            if profile.id == 25 and internal.get("cv_profile_dict") is not None:
                try:
                    result["python_dedup_check"] = run_python_dedup_check(conn, internal)
                except Exception as exc:  # noqa: BLE001
                    conn.rollback()
                    result["python_dedup_check"] = {"error": f"{type(exc).__name__}: {exc}"}

            elapsed = time.time() - t0
            result["_elapsed_seconds"] = round(elapsed, 1)
            result["_usage_after"] = dict(_usage)

            out_path = out_dir / f"profile_{profile.id:02d}_{profile.slug}.json"
            out_path.write_text(json.dumps(result, indent=2, default=str))
            print(f"    done in {elapsed:.1f}s -> {out_path.name}", flush=True)

    total_elapsed = time.time() - started
    print("\n=== C1 audit run complete ===")
    print(f"profiles run: {len(profiles)}")
    print(f"total elapsed: {total_elapsed:.1f}s")
    print(f"LLM usage: {_usage}")
    print(f"results dir: {out_dir}")


if __name__ == "__main__":
    main()
