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


def test_without_dsn_nothing_initialises(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert observability.init_sentry("worker") is False
    # Both are silent no-ops when Sentry is off.
    observability.capture(RuntimeError("x"))
    observability.heartbeat("cv-worker", 5)
