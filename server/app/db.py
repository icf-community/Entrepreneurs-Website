"""Postgres access for the CV ingest worker.

The request-serving gateway (main.py) holds no database connection, by
design — see its docstring. This module is the first direct-Postgres code
path in server/, and it exists only for worker.py and the pipeline it
drives; nothing under main.py imports this module.

A plain connection-per-call helper, not a pool: the worker is a single-
process polling loop with a concurrency cap of one job at a time (per
cv-matchmaker-spec.md's "Job queue" section — a bounded pool is the
minimum acceptable, and a lone worker process is simpler still), so there
is never more than one connection open at once.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .config import worker_settings


def conninfo(dsn: str) -> str:
    """The DSN with TLS required unless it says otherwise (B13).

    The production DSN goes over the internet to Supabase's pooler, and
    libpq's default (`prefer`) silently falls back to plaintext if TLS is
    refused. An explicit `sslmode` in the DSN wins, which is how the local
    stack (no TLS) opts out: `?sslmode=disable` (server/README.md)."""
    params = conninfo_to_dict(dsn)
    params.setdefault("sslmode", "require")
    return make_conninfo(**params)


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """One connection, one transaction. Commits on a clean exit, rolls
    back on any exception — the caller never has to remember to do
    either."""
    conn = psycopg.connect(conninfo(worker_settings().database_url))
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()
