"""CV ingest worker — polls `jobs`, processes `ingest_cv` and
`scan_github` jobs.

Run with `python -m app.worker`, in its own terminal/process — always
separate from the request-serving gateway (main.py, run via uvicorn or
gunicorn). cv-matchmaker-spec.md's "Job queue" section: a pathological CV
stalling extraction must never be able to stall a request everyone else
is waiting on, and a single polling process with a concurrency cap of one
job at a time is the minimum acceptable shape for that.

Needs both the gateway's existing env (Azure storage config — this module
calls into storage.py/documents.py/cv_sanitise.py exactly as they already
exist, unchanged) and the two worker-only vars added in config.py:
OPENAI_API_KEY and DATABASE_URL. See server/README.md.
"""

from __future__ import annotations

import logging
import os
import signal
import time
import types
import uuid

import psycopg
from psycopg.types.json import Jsonb

from . import cv_pipeline, github_pipeline
from .config import settings, worker_settings
from .cv_pipeline import SkillMatch
from .cv_sanitise import ExtractionFailed, SanitisedCv, UnsupportedContentType, sanitise_cv
from .db import connection
from .documents import RejectedDocument
from .documents import sanitise as sanitise_document
from .moderation import moderate_cv
from .storage import get_blob

log = logging.getLogger("foundry.ingest_worker")
logging.basicConfig(level=logging.INFO)

POLL_INTERVAL_SECONDS = 2.0
# Attempt 1 waits 2s, attempt 2 waits 4s, attempt 3 waits 8s, ... —
# cv-matchmaker-spec.md's "retry with exponential backoff" requirement.
BACKOFF_BASE_SECONDS = 2.0

# ─── Loop-level backoff (distinct from per-job backoff above) ────────
# A job that fails goes through _fail_job, which backs off and eventually
# dead-letters it. A failure to even *reach* the queue — the database is
# down, the pooler dropped us, credentials were rotated — never touches a
# job row, so it has none of that protection: main()'s catch-all logged
# it, slept the ordinary 2s poll interval, and tried again forever.
#
# That is the right shape (a transient blip must not kill the worker) with
# two things missing, both of which only bite in production:
#
#   * At a flat 2s the worker hammers a database that is already
#     struggling, 30 reconnects a minute per instance, for as long as the
#     outage lasts. Backing off gives a recovering pooler room.
#   * _capture() fired on EVERY iteration, so a sustained outage was
#     ~43,200 Sentry events per day per instance. That exhausts the quota
#     and buries every other error in the project — the monitoring becomes
#     useless exactly when it is needed. One event per outage is the
#     signal; 43,200 is noise.
#
# Capped at a minute: long enough to stop hammering, short enough that
# recovery is picked up promptly rather than sitting idle behind a
# multi-hour sleep with a full queue.
MAX_LOOP_BACKOFF_SECONDS = 60.0
# Re-report a still-unresolved outage occasionally so a Sentry issue that
# was resolved while the worker was still broken comes back. At the capped
# backoff this is roughly hourly.
LOOP_FAILURE_REPORT_EVERY = 60

# ─── Error reporting ────────────────────────────────────────────────
# Until now main()'s catch-all only logged, so a crash-looping worker was
# invisible unless someone happened to read journalctl — and with the
# worker started by hand there was not even a journal to read. Sentry is
# an OPTIONAL import on purpose: the package is pinned in
# requirements.txt so the container has it, but a local dev run or a test
# environment without SENTRY_DSN set degrades to logging alone rather
# than failing to start. No secret fallback (see config.py's header) —
# absent DSN means disabled, not a placeholder.
try:  # pragma: no cover — import-availability branch
    import sentry_sdk
except ImportError:  # pragma: no cover
    sentry_sdk = None  # type: ignore[assignment]

_sentry_ready = False


def _init_error_reporting() -> None:
    global _sentry_ready
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn or sentry_sdk is None:
        log.info("Sentry not configured; worker errors will be logged only")
        return
    sentry_sdk.init(dsn=dsn, traces_sample_rate=0.0)
    _sentry_ready = True


def _capture(exc: BaseException) -> None:
    if _sentry_ready and sentry_sdk is not None:
        sentry_sdk.capture_exception(exc)


def _claim_job(conn: psycopg.Connection) -> tuple[uuid.UUID, str, dict, int, int] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, kind, payload, attempts, max_attempts
              from public.jobs
             where status = 'pending' and next_attempt_at <= now()
             order by created_at
             limit 1
             for update skip locked
            """
        )
        row = cur.fetchone()
        if row is None:
            return None
        job_id, kind, payload, attempts, max_attempts = row
        cur.execute("update public.jobs set status = 'running' where id = %s", (job_id,))
        return job_id, kind, payload, attempts, max_attempts


def _finish_job(job_id: uuid.UUID) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("update public.jobs set status = 'done' where id = %s", (job_id,))


def _fail_job(job_id: uuid.UUID, attempts: int, max_attempts: int, error: str) -> None:
    """Dead-letters after max_attempts — cv-matchmaker-spec.md's "dead-
    letter state after N failures", with an admin view left as a later,
    separate build (not needed to prove the pipeline itself works)."""
    next_attempts = attempts + 1
    with connection() as conn, conn.cursor() as cur:
        if next_attempts >= max_attempts:
            cur.execute(
                "update public.jobs set status = 'dead', attempts = %s, last_error = %s where id = %s",
                (next_attempts, error[:2000], job_id),
            )
        else:
            delay = BACKOFF_BASE_SECONDS**next_attempts
            cur.execute(
                """
                update public.jobs
                   set status = 'pending', attempts = %s, last_error = %s,
                       next_attempt_at = now() + make_interval(secs => %s)
                 where id = %s
                """,
                (next_attempts, error[:2000], delay, job_id),
            )


def _set_cv_status(cv_id: uuid.UUID, status: str, *, failure_reason: str | None = None) -> None:
    """Committed immediately, in its own short transaction, so a member
    watching the processing dialog sees each step as it happens rather
    than only the final state once the whole job finishes."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "update public.cvs set status = %s, failure_reason = %s where id = %s",
            (status, failure_reason, cv_id),
        )


def _replace_member_skills(
    conn: psycopg.Connection, member_id: uuid.UUID, matches: list[SkillMatch], *, source: str
) -> None:
    """Full delete-and-reinsert, scoped to `source` — member_skills has
    no cv_id to diff against, per the spec's "CV replacement" section.
    Scoped by source (not just member_id) since a GitHub scan and a CV
    upload are independent signals for the same member and must not
    clobber each other's rows."""
    with conn.cursor() as cur:
        cur.execute(
            "delete from public.member_skills where member_id = %s and source = %s", (member_id, source)
        )
        for match in matches:
            cur.execute(
                """
                insert into public.member_skills (member_id, skill_id, raw_text, confidence, source)
                values (%s, %s, %s, %s, %s)
                """,
                (member_id, match.skill_id, match.raw_text, match.confidence, source),
            )


def _reactivate_hash_match(conn: psycopg.Connection, new_cv_id: uuid.UUID, member_id: uuid.UUID, existing_cv_id: uuid.UUID) -> None:
    """Hash-match short circuit: this exact text was already processed
    for this member. Flip currency back to the existing ready row instead
    of re-running extraction and chunk embedding — the spec's "no
    re-embedding needed" — but still recompute member_skills, since a
    different CV may have become current (and so replaced member_skills)
    in between. That costs one small embeddings call per skill string,
    not the expensive extraction/chunk-embedding steps this whole path
    exists to skip."""
    with conn.cursor() as cur:
        cur.execute("select profile from public.cv_profiles where cv_id = %s", (existing_cv_id,))
        row = cur.fetchone()
        skills_raw = row[0].get("skills_raw", []) if row else []

    matches = cv_pipeline.normalise_skills(skills_raw, conn)
    _replace_member_skills(conn, member_id, matches, source="cv")

    with conn.cursor() as cur:
        cur.execute("select public.update_cv_currency(%s)", (existing_cv_id,))
        cur.execute("update public.cvs set status = 'ready' where id = %s", (new_cv_id,))


def _sanitise_cv(cv_id: uuid.UUID, cv_container: str, blob_key: str) -> SanitisedCv | None:
    """Steps 2-3, reusing documents.py's existing sniff-and-validate (the
    same check the gateway ran at upload time — cheap, and gives us the
    real content type, which confirm_cv_upload's RPC never learns) and
    cv_sanitise.py unchanged. Returns None (having already set cvs.status
    to a terminal state) on any expected failure."""
    data = get_blob(cv_container, blob_key)
    try:
        validated = sanitise_document(data)
    except RejectedDocument as exc:
        _set_cv_status(cv_id, "failed", failure_reason=str(exc))
        return None

    with connection() as conn, conn.cursor() as cur:
        cur.execute("update public.cvs set mime_type = %s where id = %s", (validated.content_type, cv_id))

    try:
        return sanitise_cv(data, validated.content_type)
    except (ExtractionFailed, UnsupportedContentType) as exc:
        _set_cv_status(cv_id, "failed", failure_reason=str(exc))
        return None


def process_ingest_cv(cv_id: uuid.UUID) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("select member_id, blob_key from public.cvs where id = %s", (cv_id,))
        row = cur.fetchone()
    if row is None:
        raise RuntimeError(f"cvs row {cv_id} not found")
    member_id, blob_key = row

    cv_container = settings().containers["cv"]

    _set_cv_status(cv_id, "extracting")
    sanitised = _sanitise_cv(cv_id, cv_container, blob_key)
    if sanitised is None:
        return

    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "update public.cvs set raw_text = %s, raw_text_hash = %s where id = %s",
            (sanitised.raw_text, sanitised.raw_text_hash, cv_id),
        )
        cur.execute(
            """
            select id from public.cvs
             where member_id = %s and raw_text_hash = %s and status = 'ready' and id != %s
             order by created_at desc
             limit 1
            """,
            (member_id, sanitised.raw_text_hash, cv_id),
        )
        existing = cur.fetchone()
        if existing is not None:
            _reactivate_hash_match(conn, cv_id, member_id, existing[0])
            return

    if sanitised.flagged:
        log.warning("cv %s flagged by sanitisation: %s", cv_id, sanitised.flag_reasons)
        _set_cv_status(cv_id, "flagged", failure_reason="; ".join(sanitised.flag_reasons))
        return

    moderation = moderate_cv(sanitised.raw_text)
    if moderation.flagged:
        log.warning("cv %s flagged by moderation: %s", cv_id, moderation.categories)
        _set_cv_status(cv_id, "flagged", failure_reason="; ".join(moderation.categories))
        return

    _set_cv_status(cv_id, "embedding")
    extraction = cv_pipeline.extract_profile(sanitised.raw_text)

    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            insert into public.cv_profiles (cv_id, profile, summary, model_name, prompt_version)
            values (%s, %s, %s, %s, %s)
            """,
            (
                cv_id,
                Jsonb(extraction.profile),
                extraction.summary,
                extraction.model_name,
                extraction.prompt_version,
            ),
        )

        matches = cv_pipeline.normalise_skills(extraction.profile.get("skills_raw", []), conn)
        _replace_member_skills(conn, member_id, matches, source="cv")

        for chunk in cv_pipeline.chunk_and_embed(extraction.profile):
            cur.execute(
                """
                insert into public.cv_chunks (cv_id, member_id, chunk_type, content, embedding, embedding_model)
                values (%s, %s, %s, %s, %s::vector, %s)
                """,
                (
                    cv_id,
                    member_id,
                    chunk.chunk_type,
                    chunk.content,
                    cv_pipeline.vector_literal(chunk.embedding),
                    chunk.embedding_model,
                ),
            )

        cur.execute("update public.cvs set status = 'ready' where id = %s", (cv_id,))
        cur.execute("select public.update_cv_currency(%s)", (cv_id,))

        # GitHub-connects-first ordering: a scan already finished for
        # this member before this CV did, so fold it in now. (The
        # symmetric CV-first ordering is handled at the end of
        # process_scan_github.)
        cur.execute(
            "select github_signal from public.github_connections where member_id = %s and scan_status = 'ready'",
            (member_id,),
        )
        github_row = cur.fetchone()

    if github_row is not None and github_row[0] is not None:
        _refresh_combined_summary(member_id, cv_id, github_row[0])


def _set_github_status(member_id: uuid.UUID, status: str, *, failure_reason: str | None = None) -> None:
    """Same immediacy shape as _set_cv_status — its own short transaction
    so a member watching the GitHub section sees the status change as
    soon as it happens."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "update public.github_connections set scan_status = %s, scan_failure_reason = %s where member_id = %s",
            (status, failure_reason, member_id),
        )


def _apply_effective_showcase(member_id: uuid.UUID, github_signal: dict) -> dict:
    """Replace the signal's LLM-suggested `top_repos` with the repos the
    member actually chose, where they have chosen any.

    Two reasons the summary must see the EFFECTIVE set rather than the
    suggestions. First, the summary is supposed to cite the repos a
    recruiter will actually click, and after this feature those are the
    member's picks. Second, _SUMMARY_SCHEMA carries a strict naming rule
    ("only call something a repository if its name exactly matches an
    entry in github_signal.top_repos") — pointing that rule at the
    effective set keeps it coherent for free instead of letting the
    summary name a repo the profile doesn't show.

    A member's hand-written blurb takes the `description` slot, so the
    prose is grounded in how they describe their own project. It arrives
    inside the existing <github_signal> untrusted-data block, so the
    injection framing in _SUMMARY_INSTRUCTIONS already covers it."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "select showcase_repos from public.github_connections where member_id = %s", (member_id,)
        )
        row = cur.fetchone()

    picks = row[0] if row is not None else None
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


def _refresh_combined_summary(member_id: uuid.UUID, cv_id: uuid.UUID, github_signal: dict) -> None:
    """Regenerates cv_profiles.summary with GitHub evidence folded in,
    and re-embeds just the 'summary' cv_chunks row so search stays
    consistent with what's displayed. Self-contained (own connections
    either side of the LLM call, like process_ingest_cv does around
    extract_profile) rather than taking a connection from the caller, so
    it never holds a transaction open across the network call."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute("select profile from public.cv_profiles where cv_id = %s", (cv_id,))
        row = cur.fetchone()
    if row is None:
        return
    profile = row[0]

    github_signal = _apply_effective_showcase(member_id, github_signal)
    new_summary = github_pipeline.synthesize_combined_summary(profile, github_signal)
    summary_chunk = cv_pipeline.re_embed_summary(new_summary)

    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            update public.cv_profiles
               set summary = %s, summary_source = 'cv_github', summary_regenerated_at = now()
             where cv_id = %s
            """,
            (new_summary, cv_id),
        )
        cur.execute(
            """
            update public.cv_chunks
               set content = %s, embedding = %s::vector, embedding_model = %s
             where cv_id = %s and chunk_type = 'summary'
            """,
            (
                summary_chunk.content,
                cv_pipeline.vector_literal(summary_chunk.embedding),
                summary_chunk.embedding_model,
                cv_id,
            ),
        )


def _prune_dead_picks(picks: list[dict] | None, available_repos: list[dict]) -> list[dict] | None:
    """Drop any showcase pick whose repo is no longer visible — deleted,
    renamed, or made private since the member chose it.

    This is correctness, not tidiness: a recruiter clicking through to a
    404 is precisely the failure this whole feature exists to prevent.
    A pruned pick leaves at least one repo unseen relative to the
    member's picks, so get_my_github_status().needs_showcase_review goes
    true and they are actually told.

    None (never picked) stays None — pruning must not be what converts a
    member from "hasn't chosen" to "chose nothing", since those two
    states render differently."""
    if picks is None:
        return None
    live = {repo.get("name") for repo in available_repos}
    return [pick for pick in picks if pick.get("name") in live]


def process_scan_github(member_id: uuid.UUID) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select pgp_sym_decrypt(access_token_encrypted, %s), github_username,
                   scan_fingerprint, showcase_repos
              from public.github_connections
             where member_id = %s
            """,
            (worker_settings().github_token_encryption_key, member_id),
        )
        row = cur.fetchone()
    if row is None:
        raise RuntimeError(f"github_connections row for member {member_id} not found")
    access_token, github_username, previous_fingerprint, existing_picks = row

    _set_github_status(member_id, "scanning")

    try:
        signal = github_pipeline.fetch_github_signal(
            access_token, github_username, previous_fingerprint=previous_fingerprint
        )
    except github_pipeline.GithubScanError as exc:
        log.warning("github scan for member %s failed: %s", member_id, exc)
        _set_github_status(member_id, "failed", failure_reason=str(exc))
        return

    # Nothing this pipeline judges has changed since the last scan, so
    # every README fetch and both LLM calls were skipped. Bump the clock
    # so the re-scan cron stops re-picking this member and move on —
    # deliberately WITHOUT touching github_signal, member_skills or
    # available_repos, all of which are still correct.
    if signal.unchanged:
        log.info("github scan for member %s: no change since last scan, skipped", member_id)
        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                update public.github_connections
                   set scan_status = 'ready', scan_failure_reason = null, last_scanned_at = now()
                 where member_id = %s
                """,
                (member_id,),
            )
        return

    pruned_picks = _prune_dead_picks(existing_picks, signal.available_repos)

    with connection() as conn, conn.cursor() as cur:
        matches = cv_pipeline.normalise_skills(signal.languages, conn)
        _replace_member_skills(conn, member_id, matches, source="github")

        # showcase_repos is written ONLY to remove picks that no longer
        # exist. A scan must never otherwise overwrite a human choice —
        # that is the whole premise of this feature.
        cur.execute(
            """
            update public.github_connections
               set github_signal = %s, available_repos = %s, scan_fingerprint = %s,
                   showcase_repos = %s,
                   scan_status = 'ready', scan_failure_reason = null, last_scanned_at = now()
             where member_id = %s
            """,
            (
                Jsonb(signal.as_signal_dict()),
                Jsonb(signal.available_repos),
                signal.fingerprint,
                Jsonb(pruned_picks) if pruned_picks is not None else None,
                member_id,
            ),
        )

        cur.execute(
            """
            select id from public.cvs
             where member_id = %s and status = 'ready' and is_current = true
             order by created_at desc
             limit 1
            """,
            (member_id,),
        )
        current_cv = cur.fetchone()

    # CV-first ordering: a ready CV already exists for this member, so
    # fold this scan's signal into it now. (The symmetric GitHub-first
    # ordering is handled at the end of process_ingest_cv.)
    #
    # This runs even on a first connect where nothing has been picked
    # yet. That costs one extra summary generation for members who then
    # go on to pick, and buys the property that matters: a member who
    # closes the picker without choosing is never left without a summary,
    # and every state is self-healing on the next scan.
    if current_cv is not None:
        _refresh_combined_summary(member_id, current_cv[0], signal.as_signal_dict())


def process_refresh_github_summary(member_id: uuid.UUID) -> None:
    """Enqueued by set_my_github_showcase: the member changed which repos
    they spotlight, so the summary that cites those repos is now stale.

    Deliberately much cheaper than a full re-scan — one LLM call plus one
    embedding, no GitHub traffic at all — because changing your picks is
    something a member may do several times in a sitting.

    A member with no ready CV is a no-op rather than a failure: there is
    no cv_profiles row to rewrite, and the GitHub-first ordering in
    process_ingest_cv will fold the picks in when a CV does arrive."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select github_signal from public.github_connections
             where member_id = %s and scan_status = 'ready'
            """,
            (member_id,),
        )
        connection_row = cur.fetchone()

        cur.execute(
            """
            select id from public.cvs
             where member_id = %s and status = 'ready' and is_current = true
             order by created_at desc
             limit 1
            """,
            (member_id,),
        )
        current_cv = cur.fetchone()

    if connection_row is None or connection_row[0] is None or current_cv is None:
        return

    _refresh_combined_summary(member_id, current_cv[0], connection_row[0])


def _process_job(kind: str, payload: dict) -> None:
    if kind == "ingest_cv":
        process_ingest_cv(uuid.UUID(payload["cv_id"]))
    elif kind == "scan_github":
        process_scan_github(uuid.UUID(payload["member_id"]))
    elif kind == "refresh_github_summary":
        process_refresh_github_summary(uuid.UUID(payload["member_id"]))
    else:
        raise ValueError(f"Unknown job kind: {kind}")


def run_once() -> bool:
    """Claim and process a single job. Returns False if the queue was
    empty, so the caller knows whether to sleep."""
    with connection() as conn:
        claimed = _claim_job(conn)
    if claimed is None:
        return False

    job_id, kind, payload, attempts, max_attempts = claimed
    try:
        _process_job(kind, payload)
    except Exception as exc:  # noqa: BLE001 — any failure here is a retryable job failure
        log.exception("job %s (%s) failed", job_id, kind)
        _capture(exc)
        _fail_job(job_id, attempts, max_attempts, str(exc))
        return True

    _finish_job(job_id)
    return True


# Set by SIGTERM, checked BETWEEN jobs — never mid-job. A deploy or a
# `docker stop` should let the current job finish and then exit cleanly,
# rather than severing it and leaving the row stranded in 'running' for
# reap_stalled_jobs to clean up 15 minutes later (20260907000004). The
# reaper is the backstop for disorderly deaths; this is the orderly path.
#
# The unit pairs this with `docker stop -t 90`, comfortably above the
# slowest realistic job.
_stopping = False


def _handle_stop(signum: int, _frame: types.FrameType | None) -> None:
    global _stopping
    log.info("received signal %s, finishing current job then exiting", signum)
    _stopping = True


def _loop_backoff(consecutive_failures: int) -> float:
    """2s, 4s, 8s, … capped at MAX_LOOP_BACKOFF_SECONDS.

    The exponent is clamped before it is used, not after: a long outage
    reaches four figures of consecutive failures (at the 60s cap, ~1000 of
    them is under a day), and `2 ** 1023` overflows converting to float —
    which would raise straight out of the backoff call, escape main()'s
    loop, and kill the very worker this function exists to keep alive.
    Anything past the cap gives the same answer anyway.
    """
    steps = min(consecutive_failures - 1, 32)
    return min(POLL_INTERVAL_SECONDS * 2**steps, MAX_LOOP_BACKOFF_SECONDS)


def main() -> None:
    _init_error_reporting()
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    log.info("CV ingest worker starting, polling every %ss", POLL_INTERVAL_SECONDS)
    consecutive_failures = 0
    while not _stopping:
        try:
            worked = run_once()
        except Exception as exc:  # noqa: BLE001 — a claim/DB-connectivity failure must not kill the loop
            consecutive_failures += 1
            log.exception("worker loop iteration failed (consecutive: %s)", consecutive_failures)
            # First failure of a streak is the one worth paging on; after
            # that the outage is known and only periodically re-asserted.
            if consecutive_failures == 1 or consecutive_failures % LOOP_FAILURE_REPORT_EVERY == 0:
                _capture(exc)
            if not _stopping:
                time.sleep(_loop_backoff(consecutive_failures))
            continue

        consecutive_failures = 0
        if not worked and not _stopping:
            time.sleep(POLL_INTERVAL_SECONDS)

    log.info("worker stopped cleanly")


if __name__ == "__main__":
    main()
