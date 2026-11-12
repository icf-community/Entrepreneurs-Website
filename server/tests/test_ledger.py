"""Ingestion metering (app/ledger.py, AI-plan §9, F6)."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app import ledger, privacy


def test_reserves_then_settles_actual_usage(fake_ledger) -> None:
    with ledger.metered("cv_extract", "gpt-5.4-mini", payload="some text", max_output_tokens=100) as meter:
        meter.dispatched()
        meter.record(SimpleNamespace(prompt_tokens=12, completion_tokens=34))
    [(rid, stage, model, max_in, max_out)] = fake_ledger.reserved
    assert (stage, model, max_out) == ("cv_extract", "gpt-5.4-mini", 100)
    assert max_in >= ledger.estimate_tokens("some text")
    assert fake_ledger.settled == [(rid, 12, 34)]


def test_failure_before_dispatch_releases(fake_ledger) -> None:
    with pytest.raises(RuntimeError):
        with ledger.metered("embed", "text-embedding-3-small", payload="x", max_output_tokens=0):
            raise RuntimeError("never sent")
    [(rid, *_)] = fake_ledger.reserved
    assert fake_ledger.abandoned == [(rid, False)]


def test_failure_after_dispatch_keeps_the_reservation(fake_ledger) -> None:
    with pytest.raises(TimeoutError):
        with ledger.metered("embed", "text-embedding-3-small", payload="x", max_output_tokens=0) as meter:
            meter.dispatched()
            raise TimeoutError("provider may have billed")
    [(rid, *_)] = fake_ledger.reserved
    assert fake_ledger.abandoned == [(rid, True)]


def test_no_usage_reported_counts_the_upper_bound(fake_ledger) -> None:
    with ledger.metered("embed", "text-embedding-3-small", payload="x", max_output_tokens=0) as meter:
        meter.dispatched()
    assert fake_ledger.abandoned and fake_ledger.abandoned[0][1] is True


def test_exhausted_budget_makes_no_call(fake_ledger) -> None:
    fake_ledger.exhausted = True
    called = []
    with pytest.raises(ledger.BudgetExhausted):
        with ledger.metered("embed", "m", payload="x", max_output_tokens=0):
            called.append(True)
    assert not called


def test_payload_is_checked_before_anything_is_reserved(fake_ledger) -> None:
    with pytest.raises(privacy.OutboundPolicyError):
        with ledger.metered("embed", "m", payload="mail me at a@b.com", max_output_tokens=0):
            pass
    assert fake_ledger.reserved == []


def test_job_context_supplies_identifiers_to_the_check(fake_ledger) -> None:
    ids = privacy.Identifiers(names=("Priya",))
    with ledger.job_context(uuid.uuid4(), uuid.uuid4(), ids):
        assert ledger.current_identifiers() is ids
        assert ledger.outbound("Priya wrote it") == "[name] wrote it"
        with pytest.raises(privacy.OutboundPolicyError):
            with ledger.metered("embed", "m", payload="Priya wrote it", max_output_tokens=0):
                pass
    assert ledger.current_identifiers() == privacy.Identifiers()


def test_reserve_maps_the_databases_refusal(monkeypatch, real_ledger) -> None:
    import psycopg

    class Cur:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, *a):
            raise psycopg.errors.RaiseException("budget_exhausted: ingestion_daily")

    class Conn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def cursor(self):
            return Cur()

    monkeypatch.setattr(real_ledger, "connection", lambda: Conn())
    with pytest.raises(real_ledger.BudgetExhausted):
        real_ledger.reserve("embed", "m", 10, 0)
