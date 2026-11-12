"""Sentry for the gateway and the worker (launch programme G2/G3).

One init for both processes, so the privacy settings can't drift apart:

* ``send_default_pii=False`` and ``max_request_body_size="never"``: no
  cookies, auth headers, client IPs or request bodies. Upload bodies are
  CVs and photos.
* ``include_local_variables=False``: frame locals are where CV text,
  extracted profiles and GitHub payloads live while a job runs. With the
  SDK default, one exception in the pipeline would ship a member's CV.
* ``before_send`` (:func:`scrub`) is the backstop for what the settings
  can't reach: blob keys, email addresses, tokens and query strings, and
  long free text, inside exception messages, URLs, log lines, breadcrumbs,
  contexts and tags. Held to the same standard as the web app's
  ``scrubEvent.ts``, with the same hostile cases in both test suites.

Optional on purpose, like before: no ``SENTRY_DSN`` means logging only,
never a placeholder DSN (no secret fallbacks). Errors only, no tracing.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

try:  # pragma: no cover — import-availability branch
    import sentry_sdk
    from sentry_sdk.crons import capture_checkin
    from sentry_sdk.crons.consts import MonitorStatus
except ImportError:  # pragma: no cover
    sentry_sdk = None  # type: ignore[assignment]

log = logging.getLogger(__name__)

# The gateway's blob-key shape (uuid + extension) and the storage paths
# that carry it. Keys name a member's file; they don't belong in Sentry.
_BLOB_KEY = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}", re.I)
# An exception message longer than this is almost certainly carrying a
# document or a model response, not a diagnosis.
_MAX_MESSAGE = 300

# Personal and secret shapes. A Postgres error carries the offending value
# ("Key (email)=(x@y.com) already exists"), URLs carry query strings
# ("/members?q=Jane Doe"), log lines carry whatever was formatted into them.
#
# Every pattern is bounded or anchored so it runs in linear time, and strings are capped before any
# pattern touches them: an exception message can be arbitrarily large, and an unbounded "[...]+@" is
# quadratic on a long run with no "@" (300,000 characters took 99 seconds in the web scrubber's
# equivalent), which would freeze the gateway or worker inside Sentry's hook.
_MAX_STRING = 20_000
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}")
_JWT = re.compile(r"eyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{0,4096}")
_BEARER = re.compile(r"\bBearer\s{1,8}[A-Za-z0-9._~+/=-]{8,2048}", re.I)
_HEX_SECRET = re.compile(r"\b[A-Fa-f0-9]{32,}\b")
# A run of 40+ token characters, scanned once per run (the lookbehind stops it starting mid-run).
_LONG_TOKEN = re.compile(r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}")
# ?key=value... only, so a sentence ending in "?" is left alone.
_QUERY = re.compile(r"\?[\w%.~+-]{1,256}=[^\s\"'<>#]*")
_PARTIAL_TAIL = re.compile(r"[A-Za-z0-9._%+@-]{1,320}$")
_SENSITIVE_KEY = re.compile(r"pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|email|phone|session|otp|code$", re.I)
_DROP_HEADERS = {"authorization", "cookie", "set-cookie", "x-service-token", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"}
_MAX_DEPTH = 8


def _cap(text: str) -> str:
    """Cut an oversized string before scanning it; a cut can leave half an email, so drop that tail."""
    if len(text) <= _MAX_STRING:
        return text
    return _PARTIAL_TAIL.sub("", text[:_MAX_STRING]) + "…[truncated]"


def _redact(text: str) -> str:
    text = _cap(text)
    text = _JWT.sub("[jwt]", text)
    text = _BEARER.sub("Bearer [redacted]", text)
    text = _EMAIL.sub("[email]", text)
    text = _QUERY.sub("?[query]", text)
    text = _HEX_SECRET.sub("[hex]", text)
    return _LONG_TOKEN.sub("[token]", text)


def _scrub_url(url: str) -> str:
    return _redact(_BLOB_KEY.sub("[blob]", _cap(url).split("#")[0].split("?")[0]))


def _scrub_value(value: Any, depth: int = 0, key: str | None = None) -> Any:
    if key is not None and _SENSITIVE_KEY.search(key):
        return "[redacted]"
    if isinstance(value, str):
        return _redact(_BLOB_KEY.sub("[blob]", _cap(value)))
    if depth >= _MAX_DEPTH:
        return "[truncated]"
    if isinstance(value, dict):
        return {k: _scrub_value(v, depth + 1, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub_value(v, depth + 1) for v in value]
    return value

_ready = False


def _clean(text: str) -> str:
    text = _redact(_BLOB_KEY.sub("[blob]", _cap(text)))
    if len(text) > _MAX_MESSAGE:
        text = text[:_MAX_MESSAGE] + "…[truncated]"
    return text


def scrub(event: dict[str, Any], _hint: dict[str, Any] | None = None) -> dict[str, Any]:
    """Drop request payloads and redact keys/long text from messages."""
    request = event.get("request")
    if isinstance(request, dict):
        for field in ("data", "cookies", "query_string", "env"):
            request.pop(field, None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                k: (_redact(v) if isinstance(v, str) else v)
                for k, v in headers.items()
                if k.lower() not in _DROP_HEADERS
            }
        if isinstance(request.get("url"), str):
            request["url"] = _scrub_url(request["url"])

    for exc in (event.get("exception") or {}).get("values") or []:
        if isinstance(exc.get("value"), str):
            exc["value"] = _clean(exc["value"])
        for frame in (exc.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)

    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for field in ("message", "formatted"):
            if isinstance(logentry.get(field), str):
                logentry[field] = _clean(logentry[field])
        logentry.pop("params", None)
    if isinstance(event.get("message"), str):
        event["message"] = _clean(event["message"])

    for crumb in (event.get("breadcrumbs") or {}).get("values") or []:
        if isinstance(crumb.get("message"), str):
            crumb["message"] = _clean(crumb["message"])
        crumb.pop("data", None)

    event.pop("extra", None)
    # We never call set_user; make sure nothing identifying rides along.
    event.pop("user", None)
    for field in ("contexts", "tags"):
        if isinstance(event.get(field), dict):
            event[field] = _scrub_value(event[field])
    return event


def init_sentry(component: str) -> bool:
    """Initialise Sentry for ``component`` ("gateway" or "worker")."""
    global _ready
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn or sentry_sdk is None:
        log.info("Sentry not configured; %s errors will be logged only", component)
        return False
    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=0.0,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=scrub,
        # The image is built with its commit SHA (Dockerfile ARG GIT_SHA),
        # so an event names the exact GHCR image that raised it.
        release=os.environ.get("SENTRY_RELEASE") or None,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
    )
    sentry_sdk.set_tag("component", component)
    _ready = True
    return True


def capture(exc: BaseException) -> None:
    if _ready and sentry_sdk is not None:
        sentry_sdk.capture_exception(exc)


def heartbeat(slug: str, interval_minutes: int) -> None:
    """Check in with a Sentry cron monitor, creating it on first use.

    A missed check-in alerts, which is how a stopped or wedged process gets
    noticed: nothing errors when a worker simply isn't running.
    """
    if not _ready or sentry_sdk is None:
        return
    try:
        capture_checkin(
            monitor_slug=slug,
            status=MonitorStatus.OK,
            monitor_config={
                "schedule": {"type": "interval", "value": interval_minutes, "unit": "minute"},
                "checkin_margin": interval_minutes,
                "max_runtime": 1,
                "timezone": "Etc/UTC",
            },
        )
    except Exception:  # noqa: BLE001 — monitoring must never take the worker down
        log.warning("Sentry heartbeat failed", exc_info=True)
