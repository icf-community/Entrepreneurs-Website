"""G2: nothing a member uploaded reaches Sentry, whatever the SDK captured."""

from app import observability
from app.observability import scrub

KEY = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b.pdf"


def test_scrub_drops_request_payloads_and_secret_headers():
    event = {
        "request": {
            "url": f"https://gw.test/blob/{KEY}",
            "data": "%PDF-1.7 my whole CV",
            "cookies": {"sb": "x"},
            "query_string": "a=1",
            "headers": {"Authorization": "Bearer t", "X-Service-Token": "s", "User-Agent": "ua"},
        }
    }
    out = scrub(event)["request"]
    assert "data" not in out and "cookies" not in out and "query_string" not in out
    assert out["headers"] == {"User-Agent": "ua"}
    assert KEY not in out["url"]


def test_scrub_redacts_keys_and_truncates_long_exception_text():
    cv = "Jane Doe, Imperial College, Python, PyTorch " * 50
    event = {
        "exception": {
            "values": [
                {
                    "value": f"failed on {KEY}: {cv}",
                    "stacktrace": {"frames": [{"function": "f", "vars": {"raw_text": cv}}]},
                }
            ]
        },
        "extra": {"payload": cv},
    }
    out = scrub(event)
    value = out["exception"]["values"][0]["value"]
    assert KEY not in value
    assert len(value) < 400
    assert "vars" not in out["exception"]["values"][0]["stacktrace"]["frames"][0]
    assert "extra" not in out


def test_scrub_cleans_log_messages_and_breadcrumbs():
    event = {
        "logentry": {"message": "deleting %s", "params": [KEY], "formatted": f"deleting {KEY}"},
        "breadcrumbs": {"values": [{"message": f"put {KEY}", "data": {"body": "x"}}]},
    }
    out = scrub(event)
    assert "params" not in out["logentry"]
    assert KEY not in out["logentry"]["formatted"]
    crumb = out["breadcrumbs"]["values"][0]
    assert KEY not in crumb["message"] and "data" not in crumb


JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"


def _everything_leaky() -> dict:
    """The same hostile shapes the frontend scrubber is held to (scrubEvent.test.ts)."""
    return {
        "message": "failed for jane@imperial.ac.uk",
        "user": {"id": "u1", "email": "jane@imperial.ac.uk", "ip_address": "1.2.3.4"},
        "request": {
            "url": "https://gw.test/members?q=Jane%20Doe&email=jane@imperial.ac.uk",
            "headers": {"Authorization": f"Bearer {JWT}", "Referer": "https://x.test/a?email=jane@imperial.ac.uk", "User-Agent": "ua"},
        },
        "exception": {"values": [{"type": "UniqueViolation", "value": "Key (email)=(jane@imperial.ac.uk) already exists"}]},
        "logentry": {"message": "profile %s", "formatted": f"profile for jane@imperial.ac.uk token {JWT}"},
        "breadcrumbs": {"values": [{"message": "GET /members?q=Jane+Doe 200 for jane@imperial.ac.uk", "category": "httplib"}]},
        "contexts": {"custom": {"email": "jane@imperial.ac.uk"}},
        "tags": {"surface": "contact", "contact_email": "jane@imperial.ac.uk"},
    }


def test_scrub_leaves_no_email_token_or_query_string_anywhere():
    import json

    out = json.dumps(scrub(_everything_leaky()))
    assert "jane" not in out.lower()
    assert "imperial.ac.uk" not in out
    assert "eyJhbGci" not in out
    assert "1.2.3.4" not in out
    assert "q=Jane" not in out and "email=" not in out


def test_scrub_keeps_what_is_useful():
    out = scrub(_everything_leaky())
    assert out["request"]["url"] == "https://gw.test/members"
    assert out["request"]["headers"]["User-Agent"] == "ua"
    assert out["exception"]["values"][0]["type"] == "UniqueViolation"
    assert out["tags"]["surface"] == "contact"
    assert "user" not in out


def test_scrub_ordinary_messages_are_unchanged():
    event = {"exception": {"values": [{"value": "Connection reset by peer (status 502)"}]}, "message": "Is this ok? yes"}
    out = scrub(event)
    assert out["exception"]["values"][0]["value"] == "Connection reset by peer (status 502)"
    assert out["message"] == "Is this ok? yes"


def test_scrub_survives_sparse_and_odd_events():
    for event in ({}, {"exception": {}}, {"request": None}, {"breadcrumbs": None}, {"exception": {"values": [{"value": None}]}}, {"contexts": None}):
        scrub(dict(event))


def test_scrub_stays_fast_on_hostile_large_strings():
    """An exception message or log line can be arbitrarily large. An unbounded pattern is quadratic on a
    long run with no "@" (the web scrubber took 99 s on 300,000 characters), which would freeze the
    gateway or worker inside Sentry's hook."""
    import time

    for name, text in {
        "long run, no @": "a" * 300_000,
        "hyphenated run": "ab-" * 100_000,
        "repeated JWT prefix": "eyJ" * 100_000,
        "repeated local parts": "a@a" * 100_000,
        "query marks": "?a" * 150_000,
    }.items():
        event = {"exception": {"values": [{"value": text}]}, "message": text, "logentry": {"formatted": text}}
        t0 = time.perf_counter()
        scrub(event)
        assert time.perf_counter() - t0 < 0.5, f"{name} took {time.perf_counter() - t0:.1f}s"


def test_scrub_still_redacts_an_email_at_the_length_cap():
    out = scrub({"message": "x" * 19_990 + "jane@imperial.ac.uk"})["message"]
    assert "jane@" not in out and "imperial.ac" not in out


def test_without_dsn_nothing_initialises(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert observability.init_sentry("worker") is False
    # Both are silent no-ops when Sentry is off.
    observability.capture(RuntimeError("x"))
    observability.heartbeat("cv-worker", 5)
