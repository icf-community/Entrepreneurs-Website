"""Tests for the worker's job dispatch and the GitHub-signal additions
(server/app/worker.py) — the CV ingest pipeline itself is exercised by
test_cv_pipeline.py/test_cv_sanitise.py; these focus on what changed to
add the scan_github job kind.

Mocks psycopg connections throughout — same approach as
test_cv_pipeline.py's normalise_skills tests — so these run with no
database.
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app import worker
from app.cv_pipeline import SkillMatch
from app.cv_sanitise import SanitisedCv
from app.documents import ValidatedDocument
from app.github_pipeline import GithubScanError
from app.worker import (
    _apply_effective_showcase,
    _process_job,
    _prune_dead_picks,
    _refresh_combined_summary,
    _replace_member_skills,
    _revert_to_cv_only_summary,
    _set_github_status,
    process_refresh_github_summary,
    process_scan_github,
)


def _cursor_mock(fetchone_return=None) -> MagicMock:
    cur = MagicMock()
    cur.fetchone.return_value = fetchone_return
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    return cur


def _conn_mock(cursor: MagicMock) -> MagicMock:
    conn = MagicMock()
    conn.cursor.return_value = cursor
    return conn


def _connection_cm(conn: MagicMock) -> MagicMock:
    cm = MagicMock()
    cm.__enter__.return_value = conn
    cm.__exit__.return_value = False
    return cm


# ─── _replace_member_skills ─────────────────────────────────────────────


def test_replace_member_skills_deletes_only_matching_source() -> None:
    member_id = uuid.uuid4()
    cur = _cursor_mock()
    conn = _conn_mock(cur)

    _replace_member_skills(conn, member_id, [], source="github")

    delete_call = cur.execute.call_args_list[0]
    assert "source = %s" in delete_call.args[0]
    assert delete_call.args[1] == (member_id, "github")


def test_replace_member_skills_inserts_with_source() -> None:
    member_id = uuid.uuid4()
    cur = _cursor_mock()
    conn = _conn_mock(cur)
    match = SkillMatch(raw_text="Go", skill_id=None, canonical_name=None, confidence=0.0)

    _replace_member_skills(conn, member_id, [match], source="github")

    insert_call = cur.execute.call_args_list[1]
    assert "insert into public.member_skills" in insert_call.args[0]
    assert insert_call.args[1] == (member_id, None, "Go", 0.0, "github")


# ─── _process_job dispatch ───────────────────────────────────────────────


def test_process_job_dispatches_ingest_cv() -> None:
    cv_id = uuid.uuid4()
    with patch("app.worker.process_ingest_cv") as fake:
        _process_job("ingest_cv", {"cv_id": str(cv_id)})
    fake.assert_called_once_with(cv_id)


def test_process_job_dispatches_scan_github() -> None:
    member_id = uuid.uuid4()
    with patch("app.worker.process_scan_github") as fake:
        _process_job("scan_github", {"member_id": str(member_id)})
    fake.assert_called_once_with(member_id)


def test_process_job_raises_on_unknown_kind() -> None:
    with pytest.raises(ValueError):
        _process_job("something_else", {})


# ─── _refresh_combined_summary ──────────────────────────────────────────


def test_refresh_combined_summary_updates_profile_and_summary_chunk() -> None:
    member_id = uuid.uuid4()
    cv_id = uuid.uuid4()
    profile = {"summary": "cv only", "skills_raw": []}
    github_signal = {"languages": ["Rust"]}

    select_cur = _cursor_mock(fetchone_return=(profile,))
    # _apply_effective_showcase opens its own connection between the
    # profile read and the write-back; (None,) = this member has never
    # picked showcase repos, so the signal passes through untouched.
    showcase_cur = _cursor_mock(fetchone_return=(None,))
    update_cur = _cursor_mock()
    connections = [
        _connection_cm(_conn_mock(select_cur)),
        _connection_cm(_conn_mock(showcase_cur)),
        _connection_cm(_conn_mock(update_cur)),
    ]

    fake_chunk = MagicMock(content="new combined summary", embedding=[0.1, 0.2], embedding_model="text-embedding-3-small")

    with (
        patch("app.worker.connection", side_effect=connections),
        patch("app.worker.github_pipeline.synthesize_combined_summary", return_value="new combined summary") as fake_synth,
        patch("app.worker.cv_pipeline.re_embed_summary", return_value=fake_chunk),
    ):
        _refresh_combined_summary(member_id, cv_id, github_signal)

    fake_synth.assert_called_once_with(profile, github_signal)
    executed = [c.args[0] for c in update_cur.execute.call_args_list]
    assert any("update public.cv_profiles" in sql for sql in executed)
    assert any("update public.cv_chunks" in sql for sql in executed)


def test_refresh_combined_summary_is_a_noop_when_profile_missing() -> None:
    member_id = uuid.uuid4()
    cv_id = uuid.uuid4()
    select_cur = _cursor_mock(fetchone_return=None)

    with (
        patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(select_cur))]),
        patch("app.worker.github_pipeline.synthesize_combined_summary") as fake_synth,
    ):
        _refresh_combined_summary(member_id, cv_id, {"languages": []})

    fake_synth.assert_not_called()


# ─── process_ingest_cv hash-match reactivation ──────────────────────────
# A re-uploaded, byte-identical CV must reactivate onto a ready cv row
# that actually owns extraction data — not one that is itself an
# orphaned hash-match target with no cv_profiles row of its own, which
# would leave nothing for update_cv_currency to mark current and
# silently break summary regeneration for every cv_profiles row.


def test_process_ingest_cv_hash_match_query_excludes_orphaned_currency_targets() -> None:
    cv_id = uuid.uuid4()
    member_id = uuid.uuid4()
    existing_cv_id = uuid.uuid4()

    lookup_cur = _cursor_mock(fetchone_return=(member_id, "blob-key"))
    mime_cur = _cursor_mock()
    hash_cur = _cursor_mock(fetchone_return=(existing_cv_id,))

    connections = [
        _connection_cm(_conn_mock(lookup_cur)),  # select member_id, blob_key
        _connection_cm(_conn_mock(MagicMock())),  # _set_cv_status("extracting")
        _connection_cm(_conn_mock(mime_cur)),  # mime_type update inside _sanitise_cv
        _connection_cm(_conn_mock(hash_cur)),  # raw_text update + hash-match select
    ]

    sanitised = SanitisedCv(raw_text="text", raw_text_hash="hash", flagged=False)
    validated = ValidatedDocument(data=b"bytes", content_type="application/pdf", extension="pdf")

    fake_settings = MagicMock()
    fake_settings.containers = {"cv": "member-cvs"}

    with (
        patch("app.worker.connection", side_effect=connections),
        patch("app.worker.settings", return_value=fake_settings),
        patch("app.worker.get_blob", return_value=b"bytes"),
        patch("app.worker.sanitise_document", return_value=validated),
        patch("app.worker.sanitise_cv", return_value=sanitised),
        patch("app.worker._reactivate_hash_match") as fake_reactivate,
        patch("app.worker.moderate_cv") as fake_moderate,
    ):
        worker.process_ingest_cv(cv_id)

    fake_reactivate.assert_called_once()
    assert fake_reactivate.call_args.args[3] == existing_cv_id
    fake_moderate.assert_not_called()

    sql = hash_cur.execute.call_args_list[-1].args[0]
    assert "exists (select 1 from public.cv_profiles cp where cp.cv_id = c.id)" in sql


# ─── _revert_to_cv_only_summary ──────────────────────────────────────────
# Counterpart to _refresh_combined_summary, for disconnect_github
# (20260911000001) — no LLM call, since the CV-only text is still
# sitting untouched in cv_profiles.profile.


def test_revert_to_cv_only_summary_restores_original_text() -> None:
    cv_id = uuid.uuid4()
    profile = {"summary": "original cv-only summary", "skills_raw": []}
    select_cur = _cursor_mock(fetchone_return=(profile, "cv_github"))
    update_cur = _cursor_mock()

    fake_chunk = MagicMock(
        content="original cv-only summary", embedding=[0.1, 0.2], embedding_model="text-embedding-3-small"
    )

    with (
        patch(
            "app.worker.connection",
            side_effect=[_connection_cm(_conn_mock(select_cur)), _connection_cm(_conn_mock(update_cur))],
        ),
        patch("app.worker.cv_pipeline.re_embed_summary", return_value=fake_chunk) as fake_embed,
    ):
        _revert_to_cv_only_summary(cv_id)

    fake_embed.assert_called_once_with("original cv-only summary")
    executed = [c.args for c in update_cur.execute.call_args_list]
    profile_call = next(args for args in executed if "update public.cv_profiles" in args[0])
    assert profile_call[1][0] == "original cv-only summary"
    assert "cv_github" not in profile_call[1]
    assert any("update public.cv_chunks" in args[0] for args in executed)


def test_revert_to_cv_only_summary_is_a_noop_when_already_cv_only() -> None:
    """summary_source='cv' means either GitHub was never connected, or a
    fresh CV upload already replaced this row with its own CV-only
    summary — either way, nothing to revert, and no embedding call to
    spend on it."""
    cv_id = uuid.uuid4()
    select_cur = _cursor_mock(fetchone_return=({"summary": "x"}, "cv"))

    with (
        patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(select_cur))]),
        patch("app.worker.cv_pipeline.re_embed_summary") as fake_embed,
    ):
        _revert_to_cv_only_summary(cv_id)

    fake_embed.assert_not_called()


def test_revert_to_cv_only_summary_is_a_noop_when_row_missing() -> None:
    cv_id = uuid.uuid4()
    select_cur = _cursor_mock(fetchone_return=None)

    with (
        patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(select_cur))]),
        patch("app.worker.cv_pipeline.re_embed_summary") as fake_embed,
    ):
        _revert_to_cv_only_summary(cv_id)

    fake_embed.assert_not_called()


# ─── _prune_dead_picks ──────────────────────────────────────────────────
# A recruiter clicking through to a 404 is exactly the failure the
# showcase feature exists to prevent, so this is correctness, not polish.


def test_prune_dead_picks_drops_repos_that_no_longer_exist() -> None:
    picks = [{"name": "alive"}, {"name": "renamed-away"}]
    available = [{"name": "alive"}, {"name": "renamed-to"}]
    assert _prune_dead_picks(picks, available) == [{"name": "alive"}]


def test_prune_dead_picks_keeps_never_picked_as_none() -> None:
    """None (never chose) and [] (chose nothing) render differently.
    Pruning must not convert one into the other."""
    assert _prune_dead_picks(None, [{"name": "a"}]) is None


def test_prune_dead_picks_leaves_a_fully_live_showcase_untouched() -> None:
    picks = [{"name": "a", "blurb": "mine"}, {"name": "b", "blurb": None}]
    assert _prune_dead_picks(picks, [{"name": "a"}, {"name": "b"}]) == picks


# ─── _apply_effective_showcase ──────────────────────────────────────────


def test_effective_showcase_replaces_suggestions_with_member_picks() -> None:
    """The summary must cite the repos a recruiter will actually see, and
    _SUMMARY_SCHEMA's strict naming rule is defined against top_repos —
    so pointing it at the member's picks keeps that rule coherent."""
    member_id = uuid.uuid4()
    picks = [{"name": "chosen", "blurb": "My own words.", "description": "github's words",
              "language": "Rust", "stargazers_count": 3, "url": "https://github.com/x/chosen"}]
    cur = _cursor_mock(fetchone_return=(picks,))

    with patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]):
        result = _apply_effective_showcase(member_id, {"languages": ["Rust"], "top_repos": [{"name": "suggested"}]})

    assert [repo["name"] for repo in result["top_repos"]] == ["chosen"]
    # The member's blurb takes the description slot, so the prose is
    # grounded in how they describe their own project.
    assert result["top_repos"][0]["description"] == "My own words."
    assert result["languages"] == ["Rust"]  # rest of the signal untouched


def test_effective_showcase_falls_back_to_the_blurbless_description() -> None:
    member_id = uuid.uuid4()
    picks = [{"name": "chosen", "blurb": None, "description": "github's words"}]
    cur = _cursor_mock(fetchone_return=(picks,))

    with patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]):
        result = _apply_effective_showcase(member_id, {"top_repos": []})

    assert result["top_repos"][0]["description"] == "github's words"


def test_effective_showcase_keeps_llm_suggestions_when_nothing_is_picked() -> None:
    """A member who never opens the picker still gets a summary that
    cites repos — the LLM's selection is demoted to a fallback, not
    deleted."""
    member_id = uuid.uuid4()
    signal = {"top_repos": [{"name": "suggested"}]}
    cur = _cursor_mock(fetchone_return=(None,))

    with patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]):
        assert _apply_effective_showcase(member_id, signal) == signal


def test_effective_showcase_keeps_suggestions_when_picks_are_empty() -> None:
    member_id = uuid.uuid4()
    signal = {"top_repos": [{"name": "suggested"}]}
    cur = _cursor_mock(fetchone_return=([],))

    with patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]):
        assert _apply_effective_showcase(member_id, signal) == signal


# ─── refresh_github_summary job kind ────────────────────────────────────


def test_process_job_dispatches_refresh_github_summary() -> None:
    member_id = uuid.uuid4()
    with patch("app.worker.process_refresh_github_summary") as fake:
        _process_job("refresh_github_summary", {"member_id": str(member_id)})
    fake.assert_called_once_with(member_id)


def test_refresh_github_summary_is_a_noop_without_a_ready_cv() -> None:
    """Picking repos before uploading a CV is a normal order of events,
    not a failure — process_ingest_cv folds the picks in later."""
    member_id = uuid.uuid4()
    cur = MagicMock()
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    cur.fetchone.side_effect = [({"languages": []},), None]  # signal present, no CV

    with (
        patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]),
        patch("app.worker._refresh_combined_summary") as fake_refresh,
    ):
        process_refresh_github_summary(member_id)

    fake_refresh.assert_not_called()


def test_refresh_github_summary_regenerates_when_both_signals_exist() -> None:
    member_id = uuid.uuid4()
    cv_id = uuid.uuid4()
    signal = {"languages": ["Rust"]}
    cur = MagicMock()
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    cur.fetchone.side_effect = [(signal,), (cv_id,)]

    with (
        patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]),
        patch("app.worker._refresh_combined_summary") as fake_refresh,
    ):
        process_refresh_github_summary(member_id)

    fake_refresh.assert_called_once_with(member_id, cv_id, signal)


def test_refresh_github_summary_reverts_when_disconnected_with_a_ready_cv() -> None:
    """disconnect_github (20260911000001) enqueues this same job kind
    with no github_connections row left to read — the opposite of the
    two cases above, so it must revert rather than regenerate."""
    member_id = uuid.uuid4()
    cv_id = uuid.uuid4()
    cur = MagicMock()
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    cur.fetchone.side_effect = [None, (cv_id,)]  # no ready connection, but a current CV exists

    with (
        patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]),
        patch("app.worker._refresh_combined_summary") as fake_refresh,
        patch("app.worker._revert_to_cv_only_summary") as fake_revert,
    ):
        process_refresh_github_summary(member_id)

    fake_refresh.assert_not_called()
    fake_revert.assert_called_once_with(cv_id)


# ─── GitHub scan failure classification ──────────────────────────────
# 20260911000001: a primary/hourly rate limit is retryable by the
# already-hourly enqueue_github_rescans() cron; a revoked token or an
# oversized account is not, and still requires the member to reconnect.


def test_set_github_status_records_failure_transient() -> None:
    member_id = uuid.uuid4()
    cur = _cursor_mock()

    with patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]):
        _set_github_status(member_id, "failed", failure_reason="rate limited", failure_transient=True)

    params = cur.execute.call_args.args[1]
    assert params == ("failed", "rate limited", True, member_id)


def test_set_github_status_defaults_failure_transient_to_false() -> None:
    """Every non-failure call site (the 'scanning' transition included)
    must correctly clear any earlier transient flag without saying so
    explicitly."""
    member_id = uuid.uuid4()
    cur = _cursor_mock()

    with patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(cur))]):
        _set_github_status(member_id, "scanning")

    params = cur.execute.call_args.args[1]
    assert params == ("scanning", None, False, member_id)


def test_process_scan_github_forwards_retryable_flag_on_scan_error() -> None:
    member_id = uuid.uuid4()
    row_cur = _cursor_mock(fetchone_return=("token", "octocat", None, None))

    with (
        patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(row_cur))]),
        patch("app.worker.worker_settings") as fake_settings,
        patch("app.worker._set_github_status") as fake_status,
        patch(
            "app.worker.github_pipeline.fetch_github_signal",
            side_effect=GithubScanError("GitHub API rate limit exceeded", retryable_by_rescan=True),
        ),
    ):
        fake_settings.return_value.github_token_encryption_key = "test-key"
        process_scan_github(member_id)

    fake_status.assert_any_call(
        member_id,
        "failed",
        failure_reason="GitHub API rate limit exceeded",
        failure_transient=True,
    )


def test_process_scan_github_does_not_mark_dead_token_as_retryable() -> None:
    member_id = uuid.uuid4()
    row_cur = _cursor_mock(fetchone_return=("token", "octocat", None, None))

    with (
        patch("app.worker.connection", side_effect=[_connection_cm(_conn_mock(row_cur))]),
        patch("app.worker.worker_settings") as fake_settings,
        patch("app.worker._set_github_status") as fake_status,
        patch(
            "app.worker.github_pipeline.fetch_github_signal",
            side_effect=GithubScanError("GitHub token is invalid or was revoked"),
        ),
    ):
        fake_settings.return_value.github_token_encryption_key = "test-key"
        process_scan_github(member_id)

    fake_status.assert_any_call(
        member_id,
        "failed",
        failure_reason="GitHub token is invalid or was revoked",
        failure_transient=False,
    )


# ─── Loop-level failure handling ─────────────────────────────────────
# A job failure is protected by _fail_job (backoff, then dead-letter). A
# failure to reach the queue at all — DB down, pooler dropped, creds
# rotated — never touches a job row, so main()'s own handling is the only
# protection it has. These pin the two properties that matter in
# production: the worker does not hammer a struggling database, and a
# sustained outage does not emit one Sentry event every poll interval.


def test_loop_backoff_grows_then_caps() -> None:
    assert worker._loop_backoff(1) == worker.POLL_INTERVAL_SECONDS
    assert worker._loop_backoff(2) == worker.POLL_INTERVAL_SECONDS * 2
    assert worker._loop_backoff(3) == worker.POLL_INTERVAL_SECONDS * 4
    # Capped, and stays capped however long the outage runs.
    assert worker._loop_backoff(50) == worker.MAX_LOOP_BACKOFF_SECONDS
    assert worker._loop_backoff(5000) == worker.MAX_LOOP_BACKOFF_SECONDS


def test_main_backs_off_and_reports_once_during_a_sustained_outage() -> None:
    """Five consecutive claim failures: sleeps grow, and Sentry hears
    about it once rather than five times."""
    calls = {"n": 0}

    def always_fails() -> bool:
        calls["n"] += 1
        if calls["n"] > 5:
            worker._stopping = True
        raise OSError("server closed the connection unexpectedly")

    sleeps: list[float] = []
    with (
        patch.object(worker, "run_once", side_effect=always_fails),
        patch.object(worker, "time") as fake_time,
        patch.object(worker, "_capture") as fake_capture,
        patch.object(worker, "_init_error_reporting"),
        patch.object(worker, "signal"),
    ):
        fake_time.sleep.side_effect = sleeps.append
        worker._stopping = False
        try:
            worker.main()
        finally:
            worker._stopping = False

    assert sleeps[:4] == [2.0, 4.0, 8.0, 16.0], sleeps
    # Not once per iteration — that is the whole point.
    assert fake_capture.call_count == 1


def test_main_resets_the_failure_streak_after_a_success() -> None:
    """A blip followed by recovery must not leave the worker sleeping a
    minute between polls forever."""
    outcomes = [OSError("blip"), OSError("blip"), True, OSError("blip")]
    sleeps: list[float] = []

    def scripted() -> bool:
        if not outcomes:
            worker._stopping = True
            return False
        result = outcomes.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    with (
        patch.object(worker, "run_once", side_effect=scripted),
        patch.object(worker, "time") as fake_time,
        patch.object(worker, "_capture"),
        patch.object(worker, "_init_error_reporting"),
        patch.object(worker, "signal"),
    ):
        fake_time.sleep.side_effect = sleeps.append
        worker._stopping = False
        try:
            worker.main()
        finally:
            worker._stopping = False

    # 2s, 4s for the first streak; the success resets it, so the third
    # failure backs off from 2s again rather than continuing to 8s.
    assert sleeps == [2.0, 4.0, 2.0], sleeps
