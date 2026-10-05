"""Ingestion metering against the shared spend ledger (AI-plan §9, F6).

Every OpenAI call the CV worker makes reserves its upper-bound cost in
Postgres first and settles the actual usage afterwards, so ingestion
counts against its own daily cap and the controller-wide total, alongside
matching. The ledger is the authority: if it cannot be reached, or the
cap is spent, no call is made.

    with ledger.metered("cv_extract", MODEL, payload=text, max_output_tokens=8000) as meter:
        meter.dispatched()
        response = client().chat.completions.create(...)
        meter.record(response.usage)

A failure before dispatch releases the reservation. A failure after it
keeps the reservation as "unknown" (the provider may have billed), and the
daily reaper counts it at its upper bound.
"""

from __future__ import annotations

import contextvars
import math
import uuid
from contextlib import contextmanager
from typing import Iterator

import psycopg

from . import privacy
from .db import connection

# (job id, member id) of the job the worker is running, and that member's
# direct identifiers for the privacy boundary; set by worker.run_once.
_context: contextvars.ContextVar[tuple[uuid.UUID | None, uuid.UUID | None]] = contextvars.ContextVar(
    "ledger_context", default=(None, None)
)
_identifiers: contextvars.ContextVar[privacy.Identifiers] = contextvars.ContextVar(
    "ledger_identifiers", default=privacy.Identifiers()
)


class BudgetExhausted(Exception):
    """The ledger refused the reservation. No call was made."""


@contextmanager
def job_context(
    job_id: uuid.UUID | None, member_id: uuid.UUID | None, identifiers: privacy.Identifiers | None = None
) -> Iterator[None]:
    token = _context.set((job_id, member_id))
    id_token = _identifiers.set(identifiers or privacy.Identifiers())
    try:
        yield
    finally:
        _identifiers.reset(id_token)
        _context.reset(token)


def current_identifiers() -> privacy.Identifiers:
    return _identifiers.get()


def outbound(text: str | None, *, max_chars: int | None = None) -> str | None:
    """Minimise one text field for the current job's member."""
    if text is None:
        return None
    return privacy.minimise(text, current_identifiers(), max_chars=max_chars).text


def estimate_tokens(text: str) -> int:
    """Pessimistic: real tokenisers average about four characters a token
    for English; three covers code, punctuation and other scripts."""
    return max(1, math.ceil(len(text) / 3)) + 50


def reserve(stage: str, model: str, max_input_tokens: int, max_output_tokens: int) -> uuid.UUID:
    job_id, member_id = _context.get()
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                "select ai_private.worker_reserve(%s, %s, %s, %s, %s, %s)",
                (job_id, member_id, stage, model, max_input_tokens, max_output_tokens),
            )
            (reservation,) = cur.fetchone()
    except psycopg.errors.RaiseException as exc:
        if "budget_exhausted" in str(exc):
            raise BudgetExhausted(str(exc).splitlines()[0]) from exc
        raise
    return reservation


def settle(reservation: uuid.UUID, input_tokens: int, output_tokens: int) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("select ai_private.worker_settle(%s, %s, %s)", (reservation, input_tokens, output_tokens))


def abandon(reservation: uuid.UUID, *, dispatched: bool) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("select ai_private.worker_abandon(%s, %s)", (reservation, dispatched))


class Meter:
    def __init__(self) -> None:
        self.was_dispatched = False
        self.input_tokens: int | None = None
        self.output_tokens: int | None = None

    def dispatched(self) -> None:
        self.was_dispatched = True

    def record(self, usage: object) -> None:
        if usage is None:
            return
        self.input_tokens = _first_int(usage, "prompt_tokens", "input_tokens", "total_tokens")
        self.output_tokens = _first_int(usage, "completion_tokens", "output_tokens") or 0


def _first_int(obj: object, *names: str) -> int | None:
    for name in names:
        value = getattr(obj, name, None)
        if isinstance(value, int):
            return value
    return None


@contextmanager
def metered(
    stage: str,
    model: str,
    *,
    payload: str,
    max_output_tokens: int,
    identifiers: privacy.Identifiers | None = None,
) -> Iterator[Meter]:
    # The final outbound check runs on exactly what is about to be sent.
    privacy.assert_clean(payload, identifiers if identifiers is not None else current_identifiers())
    reservation = reserve(stage, model, estimate_tokens(payload), max_output_tokens)
    meter = Meter()
    try:
        yield meter
    except BaseException:
        abandon(reservation, dispatched=meter.was_dispatched)
        raise
    if meter.input_tokens is None:
        # Dispatched but no usage reported: count the upper bound.
        abandon(reservation, dispatched=True)
    else:
        settle(reservation, meter.input_tokens, meter.output_tokens or 0)
