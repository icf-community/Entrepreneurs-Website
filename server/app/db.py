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

from .config import worker_settings


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """One connection, one transaction. Commits on a clean exit, rolls
    back on any exception — the caller never has to remember to do
    either."""
    conn = psycopg.connect(worker_settings().database_url)
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()
