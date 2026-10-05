"""Postgres access for the executor: one autocommit connection per
worker task, every call a single ai_private function (the ai_service role
can do nothing else)."""

from __future__ import annotations

from typing import Any

import psycopg

from ..db import conninfo


class Db:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._conn: psycopg.AsyncConnection | None = None

    async def _connection(self) -> psycopg.AsyncConnection:
        if self._conn is None or self._conn.closed:
            self._conn = await psycopg.AsyncConnection.connect(conninfo(self._dsn), autocommit=True)
        return self._conn

    async def one(self, sql: str, params: tuple = ()) -> Any:
        conn = await self._connection()
        try:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                row = await cur.fetchone()
                return None if row is None else row[0]
        except psycopg.OperationalError:
            await self.close()
            raise

    async def rows(self, sql: str, params: tuple = ()) -> list[dict]:
        conn = await self._connection()
        try:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                names = [c.name for c in cur.description] if cur.description else []
                return [dict(zip(names, row)) for row in await cur.fetchall()]
        except psycopg.OperationalError:
            await self.close()
            raise

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
