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
from app.worker import (
    _apply_effective_showcase,
    _process_job,
    _prune_dead_picks,
    _refresh_combined_summary,
    _replace_member_skills,
    process_refresh_github_summary,
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
