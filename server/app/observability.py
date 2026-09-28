"""Sentry for the gateway and the worker (launch programme G2/G3).

One init for both processes, so the privacy settings can't drift apart:

* ``send_default_pii=False`` and ``max_request_body_size="never"``: no
  cookies, auth headers, client IPs or request bodies. Upload bodies are
  CVs and photos.
* ``include_local_variables=False``: frame locals are where CV text,
  extracted profiles and GitHub payloads live while a job runs. With the
  SDK default, one exception in the pipeline would ship a member's CV.
* ``before_send`` (:func:`scrub`) is the backstop for what the settings
  can't reach: blob keys and long free text inside exception messages.

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

_ready = False


def _clean(text: str) -> str:
    text = _BLOB_KEY.sub("[blob]", text)
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
                k: v for k, v in headers.items() if k.lower() not in {"authorization", "cookie", "x-service-token"}
            }
        if isinstance(request.get("url"), str):
            request["url"] = _BLOB_KEY.sub("[blob]", request["url"])

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
