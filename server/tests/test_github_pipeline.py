"""Tests for server/app/github_pipeline.py.

Mocks `requests` and the OpenAI client throughout — same approach as
test_cv_pipeline.py — so these run with no network access and no API key.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import requests

from app.github_pipeline import (
    EXCLUSION_EXCERPT_CHARS,
    MAX_PROMPT_TOKENS,
    MAX_REPO_PAGES,
    PER_PAGE,
    REPO_CANDIDATE_LIMIT,
    SELECTION_TOKEN_BUDGET,
    SHORTLIST_SIZE,
    TOP_REPOS_KEPT,
    GithubScanError,
    _attach_readme_excerpts,
    _budget_selection_candidates,
    _classify_exclusions,
    _estimate_tokens,
    _fetch_readme_excerpt,
    _guard_prompt_size,
    _RepoJudgment,
    _select_impressive_repos,
    _selection_payload,
    _shortlist_by_metadata,
    fetch_github_signal,
    synthesize_combined_summary,
)


def _passthrough_judgment(candidates: list[dict], profile_readme: str | None = None) -> _RepoJudgment:
    return _RepoJudgment(selected=candidates[:TOP_REPOS_KEPT], themes=[])


REPOS = [
    {
        "name": "old-project",
        "full_name": "octocat/old-project",
        "description": "An early project.",
        "language": "Python",
        "stargazers_count": 2,
        "fork": False,
        "pushed_at": "2024-01-01T00:00:00Z",
    },
    {
        "name": "popular-lib",
        "full_name": "octocat/popular-lib",
        "html_url": "https://github.com/octocat/popular-lib",
        "description": "A widely-used library.",
        "language": "TypeScript",
        "stargazers_count": 50,
        "fork": False,
        "pushed_at": "2025-06-01T00:00:00Z",
    },
    {
        "name": "someone-elses-repo",
        "full_name": "someone-else/someone-elses-repo",
        "description": "Not really theirs.",
        "language": "Go",
        "stargazers_count": 1000,
        "fork": True,
        "pushed_at": "2025-01-01T00:00:00Z",
    },
]


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


@contextmanager
def _no_repo_judging():
    """For tests only exercising repo LISTING (pagination, forks, rate
    limits, language ordering, the pre-filter score) — bypasses the README
    fetch and LLM selection judgment entirely, so a single requests.get
    mock only needs to cover the /user/repos calls those tests actually
    care about. Passes the pre-filtered candidates straight through, so
    assertions about candidate ORDER (e.g. the size-tiebreak test) still
    hold; _select_impressive_repos itself is tested separately below."""
    with (
        patch("app.github_pipeline._fetch_readme_excerpt", return_value=None),
        patch("app.github_pipeline._select_impressive_repos", side_effect=_passthrough_judgment),
    ):
        yield


# ─── fetch_github_signal ───────────────────────────────────────────────


def test_fetch_github_signal_excludes_forks() -> None:
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        signal = fetch_github_signal("token", "octocat")
    assert signal.repo_count == 2
    assert "Go" not in signal.languages
    assert all(repo["name"] != "someone-elses-repo" for repo in signal.top_repos)


def test_fetch_github_signal_dedupes_and_orders_languages_by_recency() -> None:
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        signal = fetch_github_signal("token", "octocat")
    # popular-lib (TypeScript) was pushed more recently than old-project (Python)
    assert signal.languages == ["TypeScript", "Python"]


def test_fetch_github_signal_top_repos_include_a_clickable_url() -> None:
    """These 5 are meant to be shown directly to a recruiter as links, not
    just cited in the summary prose — a missing url makes that impossible."""
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        signal = fetch_github_signal("token", "octocat")
    popular_lib = next(repo for repo in signal.top_repos if repo["name"] == "popular-lib")
    assert popular_lib["url"] == "https://github.com/octocat/popular-lib"

def test_fetch_github_signal_candidate_order_favours_stars() -> None:
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        signal = fetch_github_signal("token", "octocat")
    assert signal.top_repos[0]["name"] == "popular-lib"


def test_fetch_github_signal_candidate_order_ranks_by_size_when_stars_are_tied() -> None:
    """Regression: a personal/student account's repos usually all sit at
    0 stars, so the pre-filter candidate order must not silently degrade
    into recency order (Python's sort is stable) — a larger, more
    substantial repo must still outrank a trivial one pushed more
    recently. (This tests the pre-filter that bounds which repos reach
    the LLM judgment, not the LLM judgment itself — see
    _select_impressive_repos's own tests for that.)"""
    repos = [
        {
            "name": "tiny-recent-script",
            "full_name": "octocat/tiny-recent-script",
            "description": None,
            "language": "Python",
            "stargazers_count": 0,
            "forks_count": 0,
            "size": 5,
            "fork": False,
            "pushed_at": "2026-01-01T00:00:00Z",
        },
        {
            "name": "large-older-project",
            "full_name": "octocat/large-older-project",
            "description": "A substantial project.",
            "language": "TypeScript",
            "stargazers_count": 0,
            "forks_count": 0,
            "size": 50000,
            "fork": False,
            "pushed_at": "2020-01-01T00:00:00Z",
        },
    ]
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, repos)):
        signal = fetch_github_signal("token", "octocat")
    assert signal.top_repos[0]["name"] == "large-older-project"


def test_fetch_github_signal_candidate_order_favours_a_real_description_over_raw_size() -> None:
    """Regression: a small, polished project (e.g. a native app leaning on
    system frameworks instead of vendoring code) can have a tiny `size`
    despite being genuinely sophisticated — caught during testing, where
    a real project ranked just past the candidate cutoff on size alone,
    never reaching the LLM for judgment at all. A repo with a real,
    non-empty description should outrank a much larger but undescribed
    one on the pre-filter."""
    repos = [
        {
            "name": "large-undescribed-repo",
            "full_name": "octocat/large-undescribed-repo",
            "description": None,
            "language": "Python",
            "stargazers_count": 0,
            "forks_count": 0,
            "size": 2000,
            "fork": False,
            "pushed_at": "2025-01-01T00:00:00Z",
        },
        {
            "name": "tiny-described-app",
            "full_name": "octocat/tiny-described-app",
            "description": "A fully local, native macOS dictation app.",
            "language": "Swift",
            "stargazers_count": 1,
            "forks_count": 0,
            "size": 58,
            "fork": False,
            "pushed_at": "2024-01-01T00:00:00Z",
        },
    ]
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, repos)):
        signal = fetch_github_signal("token", "octocat")
    assert signal.top_repos[0]["name"] == "tiny-described-app"


def test_fetch_github_signal_empty_repos_is_not_an_error() -> None:
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, [])):
        signal = fetch_github_signal("token", "octocat")
    assert signal.languages == []
    assert signal.repo_count == 0


def test_fetch_github_signal_raises_on_revoked_token() -> None:
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(401, {})):
        with pytest.raises(GithubScanError):
            fetch_github_signal("token", "octocat")


def test_fetch_github_signal_raises_scan_error_on_primary_rate_limit() -> None:
    """403/429 with no Retry-After header is the hourly-window primary
    rate limit — not worth the job queue's short backoff, so this is a
    clean, immediate failure rather than a retryable exception."""
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(403, {})):
        with pytest.raises(GithubScanError):
            fetch_github_signal("token", "octocat")


def test_fetch_github_signal_lets_secondary_rate_limit_propagate_for_retry() -> None:
    """403/429 WITH a Retry-After header is the short-lived secondary/
    abuse limit — this should NOT be a GithubScanError, so the worker's
    normal job-queue retry/backoff (not the immediate-failure path)
    handles it."""
    with (
        _no_repo_judging(),
        patch(
            "app.github_pipeline.requests.get",
            return_value=_fake_response(403, {}, headers={"Retry-After": "30"}),
        ),
    ):
        with pytest.raises(requests.HTTPError):
            fetch_github_signal("token", "octocat")


def test_fetch_github_signal_paginates_up_to_the_cap() -> None:
    full_page = [
        {"name": f"repo-{i}", "full_name": f"octocat/repo-{i}", "language": "Python", "fork": False, "stargazers_count": 0}
        for i in range(PER_PAGE)
    ]
    # Every page comes back full, so pagination should stop at the cap
    # (MAX_REPO_PAGES) rather than looping forever.
    with (
        _no_repo_judging(),
        patch("app.github_pipeline.requests.get", return_value=_fake_response(200, full_page)) as fake_get,
    ):
        signal = fetch_github_signal("token", "octocat")
    assert fake_get.call_count == 3  # MAX_REPO_PAGES
    assert signal.repo_count == PER_PAGE * 3


def test_fetch_github_signal_stops_at_a_partial_page() -> None:
    first_page = [
        {"name": f"repo-{i}", "full_name": f"octocat/repo-{i}", "language": "Python", "fork": False, "stargazers_count": 0}
        for i in range(PER_PAGE)
    ]
    second_page = [
        {"name": "last-repo", "full_name": "octocat/last-repo", "language": "Rust", "fork": False, "stargazers_count": 0}
    ]
    with (
        _no_repo_judging(),
        patch(
            "app.github_pipeline.requests.get",
            side_effect=[_fake_response(200, first_page), _fake_response(200, second_page)],
        ) as fake_get,
    ):
        signal = fetch_github_signal("token", "octocat")
    assert fake_get.call_count == 2
    assert signal.repo_count == PER_PAGE + 1


def test_fetch_github_signal_wires_readme_excerpts_into_selection() -> None:
    """End-to-end wiring check: a candidate's README excerpt AND the
    account's profile README (fetched from the real /repos/{...}/readme
    endpoints) must actually reach _select_impressive_repos, not just get
    fetched and dropped."""
    single_repo = [REPOS[0]]  # old-project, octocat/old-project

    def _get(url: str, **kwargs) -> MagicMock:
        if url.endswith("/user/repos"):
            return _fake_response(200, single_repo)
        if url.endswith("/repos/octocat/old-project/readme"):
            return _fake_response(200, "# Old Project\nA real README.")
        if url.endswith("/repos/octocat/octocat/readme"):
            return _fake_response(200, "# Hi, I'm octocat\nHackathon winner.")
        raise AssertionError(f"unexpected GET {url}")

    with (
        patch("app.github_pipeline.requests.get", side_effect=_get),
        patch("app.github_pipeline._select_impressive_repos") as fake_select,
    ):
        fake_select.side_effect = _passthrough_judgment
        signal = fetch_github_signal("token", "octocat")

    (candidates_arg, profile_readme_arg), _ = fake_select.call_args
    assert candidates_arg[0]["readme_excerpt"] == "# Old Project\nA real README."
    assert profile_readme_arg == "# Hi, I'm octocat\nHackathon winner."
    assert signal.profile_readme == "# Hi, I'm octocat\nHackathon winner."


def test_fetch_github_signal_profile_readme_is_none_when_account_has_none() -> None:
    """Most accounts don't have a profile README (the special
    username/username repo) — a 404 there is not an error."""
    single_repo = [REPOS[0]]

    def _get(url: str, **kwargs) -> MagicMock:
        if url.endswith("/user/repos"):
            return _fake_response(200, single_repo)
        if url.endswith("/readme"):
            return _fake_response(404, {})
        raise AssertionError(f"unexpected GET {url}")

    with (
        patch("app.github_pipeline.requests.get", side_effect=_get),
        patch("app.github_pipeline._select_impressive_repos", side_effect=_passthrough_judgment),
    ):
        signal = fetch_github_signal("token", "octocat")
    assert signal.profile_readme is None


# ─── _fetch_readme_excerpt ──────────────────────────────────────────────


def test_fetch_readme_excerpt_returns_none_when_missing() -> None:
    with patch("app.github_pipeline.requests.get", return_value=_fake_response(404, {})):
        assert _fetch_readme_excerpt("token", "octocat/no-readme") is None


def test_fetch_readme_excerpt_returns_none_on_network_error() -> None:
    """A README fetch is best-effort enhancement, not core to the scan —
    a transient network failure here must not blow up the whole scan."""
    with patch("app.github_pipeline.requests.get", side_effect=requests.ConnectionError("boom")):
        assert _fetch_readme_excerpt("token", "octocat/repo") is None


def test_fetch_readme_excerpt_truncates_long_readmes() -> None:
    long_readme = "x" * 5000
    with patch("app.github_pipeline.requests.get", return_value=_fake_response(200, long_readme)):
        excerpt = _fetch_readme_excerpt("token", "octocat/repo")
    assert excerpt is not None
    assert len(excerpt) == 1500  # README_EXCERPT_CHARS


def _fake_chat_response(content: str | None) -> SimpleNamespace:
    message = SimpleNamespace(content=content)
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


# ─── _classify_exclusions ────────────────────────────────────────────────
# Deliberately its own, narrow call (see the module comment above
# _EXCLUSION_SCHEMA) — a single mega-prompt that tried to do exclusion AND
# depth-judgment together proved unreliable in manual testing (it
# sometimes selected hard-excluded repos anyway).


def test_classify_exclusions_returns_empty_set_for_no_candidates() -> None:
    assert _classify_exclusions([]) == set()


def test_classify_exclusions_parses_the_models_answer() -> None:
    candidates = [{"name": "take-home-solution", "description": None, "readme_excerpt": None}]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(
        json.dumps({"excluded": ["take-home-solution"]})
    )
    with patch("app.github_pipeline.client", return_value=fake_client):
        excluded = _classify_exclusions(candidates)
    assert excluded == {"take-home-solution"}


def test_classify_exclusions_fails_open_when_model_returns_no_content() -> None:
    """Excluding nothing on a parse failure is the safe default — the
    depth-judgment stage still has its own bar for candidates to clear."""
    candidates = [{"name": "a", "description": None, "readme_excerpt": None}]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(None)
    with patch("app.github_pipeline.client", return_value=fake_client):
        excluded = _classify_exclusions(candidates)
    assert excluded == set()


# ─── _select_impressive_repos ───────────────────────────────────────────


def test_select_impressive_repos_never_shows_an_excluded_repo_to_the_depth_call() -> None:
    """Wiring check for the two-stage split: a repo _classify_exclusions
    flags must never even appear in the payload sent to the depth-judgment
    call, so that call cannot override the exclusion no matter how it
    reasons about depth."""
    candidates = [
        {"name": "take-home-solution", "description": "My solution to Acme's take home challenge.", "language": "Python", "stargazers_count": 0},
        {"name": "real-project", "description": "A genuinely deep project.", "language": "Python", "stargazers_count": 3},
    ]
    fake_client = MagicMock()
    fake_client.chat.completions.create.side_effect = [
        _fake_chat_response(json.dumps({"excluded": ["take-home-solution"]})),
        _fake_chat_response(json.dumps({"selected": ["real-project"], "themes": []})),
    ]
    with patch("app.github_pipeline.client", return_value=fake_client):
        judgment = _select_impressive_repos(candidates)

    assert [repo["name"] for repo in judgment.selected] == ["real-project"]
    depth_call_args = fake_client.chat.completions.create.call_args_list[1]
    depth_user_message = next(m["content"] for m in depth_call_args.kwargs["messages"] if m["role"] == "user")
    assert "take-home-solution" not in depth_user_message


def test_select_impressive_repos_returns_empty_for_no_candidates() -> None:
    judgment = _select_impressive_repos([])
    assert judgment.selected == []
    assert judgment.themes == []


def test_select_impressive_repos_filters_to_the_models_selection() -> None:
    candidates = [
        {"name": "deep-project", "description": "A RAG pipeline.", "language": "Python", "stargazers_count": 0},
        {"name": "tutorial-clone", "description": "Following a course.", "language": "Python", "stargazers_count": 0},
    ]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(
        json.dumps({"selected": ["deep-project"], "themes": ["retrieval-augmented generation"]})
    )
    with patch("app.github_pipeline.client", return_value=fake_client):
        judgment = _select_impressive_repos(candidates)
    assert [repo["name"] for repo in judgment.selected] == ["deep-project"]
    assert judgment.themes == ["retrieval-augmented generation"]


def test_select_impressive_repos_fails_open_when_model_returns_no_content() -> None:
    candidates = [{"name": "a", "description": "A real project with substantive content.", "language": "Python", "stargazers_count": 0}]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(None)
    with patch("app.github_pipeline.client", return_value=fake_client):
        judgment = _select_impressive_repos(candidates)
    assert judgment.selected == candidates
    assert judgment.themes == []


def test_select_impressive_repos_respects_a_deliberate_empty_selection() -> None:
    """Regression: a model judging that NONE of the candidates clear the
    bar (a legitimate, valid answer — e.g. every repo is either a take-home
    challenge or has no real content) must not get silently overridden and
    padded back up to TOP_REPOS_KEPT — that would defeat the point of
    letting the model say 'none of these are good enough'."""
    candidates = [{"name": "a", "description": "A real project with substantive content.", "language": "Python", "stargazers_count": 0}]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"selected": [], "themes": []}))
    with patch("app.github_pipeline.client", return_value=fake_client):
        judgment = _select_impressive_repos(candidates)
    assert judgment.selected == []


def test_select_impressive_repos_pads_only_on_an_unusable_response() -> None:
    """Distinct from the above: if the model names repos that don't match
    ANY real candidate (a hallucinated/mismatched name), that response is
    unusable, not a valid 'select none' — this is the one case that should
    still fail open to the ordering signal."""
    candidates = [{"name": "a", "description": "A real project with substantive content.", "language": "Python", "stargazers_count": 0}]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(
        json.dumps({"selected": ["does-not-exist"], "themes": []})
    )
    with patch("app.github_pipeline.client", return_value=fake_client):
        judgment = _select_impressive_repos(candidates)
    assert judgment.selected == candidates


def test_select_impressive_repos_uses_strict_structured_outputs() -> None:
    candidates = [{"name": "a", "description": "A real project with substantive content.", "language": "Python", "stargazers_count": 0}]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"selected": ["a"]}))
    with patch("app.github_pipeline.client", return_value=fake_client):
        _select_impressive_repos(candidates)
    _, kwargs = fake_client.chat.completions.create.call_args
    assert kwargs["response_format"]["json_schema"]["strict"] is True


def test_select_impressive_repos_includes_profile_readme_when_present() -> None:
    """Regression: a hackathon-named repo with an empty README can be the
    exact project described in detail on the account's profile page —
    that context must actually reach the model, not just get fetched."""
    candidates = [{"name": "a", "description": "A real project with substantive content.", "language": "Python", "stargazers_count": 0}]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"selected": ["a"]}))
    with patch("app.github_pipeline.client", return_value=fake_client):
        _select_impressive_repos(candidates, profile_readme="Won an award for project 'a'.")
    _, kwargs = fake_client.chat.completions.create.call_args
    user_message = next(m["content"] for m in kwargs["messages"] if m["role"] == "user")
    assert "<profile_readme>" in user_message
    assert "Won an award for project 'a'." in user_message


def test_select_impressive_repos_omits_profile_readme_block_when_absent() -> None:
    candidates = [{"name": "a", "description": "A real project with substantive content.", "language": "Python", "stargazers_count": 0}]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"selected": ["a"]}))
    with patch("app.github_pipeline.client", return_value=fake_client):
        _select_impressive_repos(candidates, profile_readme=None)
    _, kwargs = fake_client.chat.completions.create.call_args
    user_message = next(m["content"] for m in kwargs["messages"] if m["role"] == "user")
    assert "<profile_readme>" not in user_message


# ─── synthesize_combined_summary ────────────────────────────────────────


def test_synthesize_combined_summary_returns_model_summary() -> None:
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"summary": "Combined."}))
    with patch("app.github_pipeline.client", return_value=fake_client):
        result = synthesize_combined_summary({"summary": "cv only"}, {"languages": ["Python"]})
    assert result == "Combined."


def test_synthesize_combined_summary_uses_strict_structured_outputs() -> None:
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"summary": "x"}))
    with patch("app.github_pipeline.client", return_value=fake_client):
        synthesize_combined_summary({}, {})
    _, kwargs = fake_client.chat.completions.create.call_args
    assert kwargs["response_format"]["json_schema"]["strict"] is True


def test_synthesize_combined_summary_passes_both_inputs_as_data_not_instructions() -> None:
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"summary": "x"}))
    with patch("app.github_pipeline.client", return_value=fake_client):
        synthesize_combined_summary({"summary": "cv text"}, {"languages": ["Rust"]})
    _, kwargs = fake_client.chat.completions.create.call_args
    user_message = next(m["content"] for m in kwargs["messages"] if m["role"] == "user")
    assert "<profile>" in user_message and "cv text" in user_message
    assert "<github_signal>" in user_message and "Rust" in user_message


# ─── available_repos / as_signal_dict ──────────────────────────────────
# The member's repo picker renders straight out of available_repos, so it
# has to carry EVERY non-fork repo (not the LLM's shortlist) while
# staying small enough to sit in a column read on every render.


def test_available_repos_lists_every_non_fork_repo() -> None:
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        signal = fetch_github_signal("token", "octocat")

    names = [repo["name"] for repo in signal.available_repos]
    assert names == ["popular-lib", "old-project"]  # newest push first
    assert "someone-elses-repo" not in names  # the fork


def test_available_repos_carry_no_readme_excerpt() -> None:
    """readme_excerpt is the large field. It belongs in the LLM prompts
    and nowhere near a column the picker reads on every open."""
    with (
        patch("app.github_pipeline._fetch_readme_excerpt", return_value="x" * 1500),
        patch("app.github_pipeline._select_impressive_repos", side_effect=_passthrough_judgment),
        patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)),
    ):
        signal = fetch_github_signal("token", "octocat")

    for repo in signal.available_repos:
        assert "readme_excerpt" not in repo
        assert set(repo) == {"name", "description", "language", "stargazers_count", "url", "pushed_at"}


def test_as_signal_dict_excludes_available_repos_and_scan_control_fields() -> None:
    """github_signal is the DERIVED signal. available_repos is a separate
    column, and fingerprint/unchanged are scan control flow — none of the
    three should reach the stored blob or the summary prompt."""
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        signal = fetch_github_signal("token", "octocat")

    assert set(signal.as_signal_dict()) == {
        "languages",
        "repo_count",
        "top_repos",
        "profile_readme",
        "themes",
    }
    # as_dict() stays the full dataclass, so existing callers of it are
    # unaffected by the projection existing.
    assert "available_repos" in signal.as_dict()


# ─── Fingerprint short-circuit ─────────────────────────────────────────


def test_unchanged_account_skips_readmes_and_both_llm_calls() -> None:
    """The whole point of the fingerprint: an hourly re-scan cadence is
    only affordable if a no-change scan costs just the repo listing."""
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        first = fetch_github_signal("token", "octocat")

    with (
        patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)),
        patch("app.github_pipeline._fetch_readme_excerpt") as fake_readme,
        patch("app.github_pipeline._select_impressive_repos") as fake_select,
    ):
        second = fetch_github_signal("token", "octocat", previous_fingerprint=first.fingerprint)

    assert second.unchanged is True
    assert second.fingerprint == first.fingerprint
    fake_readme.assert_not_called()
    fake_select.assert_not_called()


def test_no_previous_fingerprint_always_does_a_full_scan() -> None:
    """A fresh connect has nothing to compare against and must never skip."""
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        signal = fetch_github_signal("token", "octocat")
    assert signal.unchanged is False
    assert signal.fingerprint is not None


def test_fingerprint_changes_when_a_repo_disappears() -> None:
    """A deleted or renamed repo is exactly when showcase_repos needs
    pruning, so it must bust the fingerprint — which is why the digest is
    over the NAME SET, not just the newest push timestamp."""
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        before = fetch_github_signal("token", "octocat")

    fewer = [repo for repo in REPOS if repo["name"] != "old-project"]
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, fewer)):
        after = fetch_github_signal("token", "octocat")

    assert before.fingerprint != after.fingerprint


def test_fingerprint_changes_when_a_repo_gets_new_commits() -> None:
    pushed_later = [{**repo, "pushed_at": "2026-09-01T00:00:00Z"} for repo in REPOS]
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        before = fetch_github_signal("token", "octocat")
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, pushed_later)):
        after = fetch_github_signal("token", "octocat")

    assert before.fingerprint != after.fingerprint


def test_fingerprint_ignores_star_and_fork_churn() -> None:
    """Stars drift constantly and change nothing this pipeline judges. If
    they busted the fingerprint, the short-circuit would almost never
    fire and the saving would be imaginary."""
    restarred = [{**repo, "stargazers_count": repo["stargazers_count"] + 40} for repo in REPOS]
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, REPOS)):
        before = fetch_github_signal("token", "octocat")
    with _no_repo_judging(), patch("app.github_pipeline.requests.get", return_value=_fake_response(200, restarred)):
        after = fetch_github_signal("token", "octocat")

    assert before.fingerprint == after.fingerprint


# ─── B2.6: bounding the repo-judgment prompts ──────────────────────────
# Every candidate's README excerpt used to go to _classify_exclusions AND
# _select_impressive_repos, with no token budget on either. At the
# 300-repo ceiling that is ~112k tokens per call — a path that had never
# once been exercised, because every round of prompt tuning ran against a
# single ~20-repo account.


def _many_repos(count: int, *, start: int = 0, total: int = 300) -> list[dict]:
    return [
        {
            "name": f"repo-{i:03d}",
            "full_name": f"octocat/repo-{i:03d}",
            "html_url": f"https://github.com/octocat/repo-{i:03d}",
            "description": f"Project number {i}.",
            "language": "Python",
            # Descending, so _repo_impressiveness_score order is
            # predictable and the test can assert WHICH repos survive.
            "stargazers_count": total - i,
            "fork": False,
            "pushed_at": "2026-01-01T00:00:00Z",
        }
        for i in range(start, start + count)
    ]


def test_exclusion_call_uses_the_short_excerpt() -> None:
    """Stage 1 only asks "is this a take-home / does it admit hardcoded
    credentials" — both announce themselves in a README's opening lines,
    so the remaining ~1100 chars per repo were pure cost."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"excluded": []}))
    candidates = [{"name": "a", "description": "d", "readme_excerpt": "x" * 1500}]

    with patch("app.github_pipeline.client", return_value=fake_client):
        _classify_exclusions(candidates)

    _, kwargs = fake_client.chat.completions.create.call_args
    user_message = next(m["content"] for m in kwargs["messages"] if m["role"] == "user")
    payload = json.loads(user_message.split("<candidate_repos>\n")[1].split("\n</candidate_repos>")[0])
    assert len(payload[0]["readme_excerpt"]) == EXCLUSION_EXCERPT_CHARS
    # And it drops the fields this call never reads.
    assert set(payload[0]) == {"name", "description", "readme_excerpt"}


def test_normal_sized_account_never_takes_the_shortlist_path() -> None:
    """Below the budget — very nearly every member — behaviour must be
    bit-for-bit what it was, or this change silently regresses six rounds
    of tuning on the selection call."""
    candidates = [
        {"name": f"r{i}", "description": "d", "readme_excerpt": "x" * 1500, "stargazers_count": 0}
        for i in range(20)
    ]
    with patch("app.github_pipeline._shortlist_by_metadata") as fake_shortlist:
        result = _budget_selection_candidates(candidates)

    fake_shortlist.assert_not_called()
    assert result == candidates


def test_oversized_account_shortlists_before_reading_readmes() -> None:
    candidates = [
        {"name": f"r{i}", "description": "d", "readme_excerpt": "x" * 1500, "stargazers_count": 0}
        for i in range(300)
    ]
    with patch("app.github_pipeline._shortlist_by_metadata", side_effect=lambda c: c[:SHORTLIST_SIZE]) as fake:
        result = _budget_selection_candidates(candidates)

    fake.assert_called_once()
    assert len(result) <= SHORTLIST_SIZE


def test_oversized_account_stays_under_the_selection_budget() -> None:
    """The hard guarantee behind the shortlist: even a shortlist of
    unusually README-heavy repos gets packed down to the budget."""
    candidates = [
        {"name": f"r{i}", "description": "d", "readme_excerpt": "x" * 1500, "stargazers_count": 0}
        for i in range(300)
    ]
    result = _budget_selection_candidates(candidates)
    assert _estimate_tokens(json.dumps(_selection_payload(result))) <= SELECTION_TOKEN_BUDGET


def test_shortlist_keeps_the_strongest_repos_when_it_falls_back() -> None:
    """A failed shortlist call must degrade to the impressiveness
    ordering, not to an arbitrary slice and not to a failed scan."""
    candidates = [{"name": f"r{i}", "description": "d", "stargazers_count": 300 - i} for i in range(300)]
    fake_client = MagicMock()
    fake_client.chat.completions.create.side_effect = RuntimeError("model unavailable")

    with patch("app.github_pipeline.client", return_value=fake_client):
        result = _shortlist_by_metadata(candidates)

    assert [repo["name"] for repo in result] == [f"r{i}" for i in range(SHORTLIST_SIZE)]


def test_shortlist_filters_to_the_models_answer() -> None:
    candidates = [{"name": f"r{i}", "description": "d", "stargazers_count": 0} for i in range(300)]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(
        json.dumps({"shortlist": ["r5", "r250"]})
    )
    with patch("app.github_pipeline.client", return_value=fake_client):
        result = _shortlist_by_metadata(candidates)

    assert [repo["name"] for repo in result] == ["r5", "r250"]


def test_shortlist_call_sends_no_readmes() -> None:
    """The point of the metadata-only pass: all 300 repos fit in ~9k
    tokens, so nothing is cut by a blind cutoff before a model sees it."""
    candidates = [
        {"name": f"r{i}", "description": "d", "readme_excerpt": "x" * 1500, "stargazers_count": 0}
        for i in range(300)
    ]
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_chat_response(json.dumps({"shortlist": []}))
    with patch("app.github_pipeline.client", return_value=fake_client):
        _shortlist_by_metadata(candidates)

    _, kwargs = fake_client.chat.completions.create.call_args
    user_message = next(m["content"] for m in kwargs["messages"] if m["role"] == "user")
    assert "readme_excerpt" not in user_message
    assert _estimate_tokens(user_message) < 20_000


def test_guard_raises_a_legible_error_rather_than_a_provider_error() -> None:
    """A scan that fails must explain itself in scan_failure_reason."""
    with pytest.raises(GithubScanError, match="too large to analyse"):
        _guard_prompt_size("x" * (MAX_PROMPT_TOKENS * 5))


def test_three_hundred_repo_account_completes_a_full_scan() -> None:
    """End to end at the ceiling — the case the pipeline had never run."""
    pages = [
        _fake_response(200, _many_repos(PER_PAGE, start=page * PER_PAGE))
        for page in range(MAX_REPO_PAGES)
    ]
    fake_client = MagicMock()
    fake_client.chat.completions.create.side_effect = [
        _fake_chat_response(json.dumps({"excluded": []})),          # stage 1
        _fake_chat_response(json.dumps({"shortlist": ["repo-000"]})),  # metadata pass
        _fake_chat_response(json.dumps({"selected": ["repo-000"], "themes": ["systems"]})),
    ]
    with (
        patch("app.github_pipeline.requests.get", side_effect=pages),
        patch("app.github_pipeline._fetch_readme_excerpt", return_value="x" * 1500),
        patch("app.github_pipeline.client", return_value=fake_client),
    ):
        signal = fetch_github_signal("token", "octocat")

    assert [repo["name"] for repo in signal.top_repos] == ["repo-000"]
    # Every repo is still pickable by the member even though only a
    # shortlist was read in full.
    assert len(signal.available_repos) == REPO_CANDIDATE_LIMIT


# ─── B2.3: concurrent README fetches ───────────────────────────────────


def test_every_candidate_still_gets_a_readme_and_order_is_preserved() -> None:
    """Parallelising the fetch must not drop a repo or reorder the
    candidate list — the impressiveness ordering is what decides which
    repos survive budgeting."""
    candidates = [{"name": f"r{i}", "full_name": f"octocat/r{i}"} for i in range(20)]
    with patch("app.github_pipeline._fetch_readme_excerpt", side_effect=lambda _t, name: f"readme:{name}"):
        _attach_readme_excerpts("token", candidates)

    assert [repo["name"] for repo in candidates] == [f"r{i}" for i in range(20)]
    for repo in candidates:
        assert repo["readme_excerpt"] == f"readme:{repo['full_name']}"


def test_attach_readme_excerpts_handles_an_empty_candidate_list() -> None:
    _attach_readme_excerpts("token", [])  # must not raise or open a pool
