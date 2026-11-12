"""Shared fixtures.

The ledger is the authority on spend and lives in Postgres; unit tests
mock the provider and have no database, so the ledger's three calls are
replaced with in-memory stand-ins for every test. Tests that are about
the ledger itself (test_ledger.py) reach the real functions through
`real_ledger`.
"""

from __future__ import annotations

import uuid

import pytest

from app import ledger


class FakeLedger:
    def __init__(self) -> None:
        self.reserved: list[tuple] = []
        self.settled: list[tuple] = []
        self.abandoned: list[tuple] = []
        self.exhausted = False

    def reserve(self, stage, model, max_in, max_out):
        if self.exhausted:
            raise ledger.BudgetExhausted("budget_exhausted: test")
        rid = uuid.uuid4()
        self.reserved.append((rid, stage, model, max_in, max_out))
        return rid

    def settle(self, rid, input_tokens, output_tokens):
        self.settled.append((rid, input_tokens, output_tokens))

    def abandon(self, rid, *, dispatched):
        self.abandoned.append((rid, dispatched))


@pytest.fixture(autouse=True)
def fake_ledger(monkeypatch, request):
    if "real_ledger" in request.fixturenames:
        yield None
        return
    fake = FakeLedger()
    monkeypatch.setattr(ledger, "reserve", fake.reserve)
    monkeypatch.setattr(ledger, "settle", fake.settle)
    monkeypatch.setattr(ledger, "abandon", fake.abandon)
    yield fake


@pytest.fixture
def real_ledger():
    return ledger
