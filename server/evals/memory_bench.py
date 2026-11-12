"""Memory recall benchmark + paired memory-cost measurement (S5 gap 6,
O09). python -m evals memory-bench --dsn postgresql://postgres:postgres@127.0.0.1:54322/postgres

Drives datasets/memory.jsonl through the real executor and the real
ai_private.exec_memory, exactly like test_ai_memory.py's hardcoded
example, generalised to more cases and reported as a rate rather than a
handful of pass/fail asserts. Opt-in, local-DB only (fake_provider's own
assert_local() guard already refuses anything else).
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

DATASETS = Path(__file__).resolve().parent / "datasets"
AI_SERVICE_PASSWORD = "ai_service-local"


def _dsn_for(dsn: str, role: str, password: str) -> str:
    params = psycopg.conninfo.conninfo_to_dict(dsn)
    params.update(user=role, password=password, sslmode="disable")
    return psycopg.conninfo.make_conninfo(**params)


def _sql(conn, query: str, params: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall() if cur.description else None


def _as_member(conn, uid, query: str, params: tuple = ()):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)",
                       (json.dumps({"sub": str(uid), "role": "authenticated"}),))
            cur.execute(query, params)
            return cur.fetchall() if cur.description else None


def _make_member(conn, tag: str, key: str) -> uuid.UUID:
    uid = uuid.uuid4()
    _sql(conn, "insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token, "
               "recovery_token, email_change_token_new, email_change, aud, role) values (%s, %s, %s, "
               "'{\"provider\":\"email\"}', '', '', '', '', 'authenticated', 'authenticated')",
        (uid, f"membench-{tag}-{key}@imperial.ac.uk",
         Jsonb({"first_name": "Bench", "surname": key, "role": "student", "grad_year": 2028})))
    with conn.transaction():
        _sql(conn, "select set_config('foundry.onboarding_submission', 'true', true)")
        _sql(conn, "update public.profiles set status = 'approved', course = 'Computing' where id = %s", (uid,))
    _sql(conn, "insert into public.member_education (member_id, currently_enrolled, has_completed_degree) "
               "values (%s, true, false)", (uid,))
    _sql(conn, "insert into ai_private.member_settings (member_id, recruiter_discoverable, network_discoverable, "
               "evidence_sharing, use_chat_memory, consent_version, consent_epoch) "
               "values (%s, false, true, false, true, 'membench', 1)", (uid,))
    return uid


def _submit(conn, uid, message: str) -> uuid.UUID:
    row = _as_member(conn, uid, "select * from public.ai_submit_turn('network', null, null, 'message', %s, %s, "
                     "null, false)", (message, uuid.uuid4().hex))[0]
    assert row[2] == "queued", (message, row[2])
    return row[0]


def _run_executor_once(dsn: str) -> None:
    import asyncio

    os.environ["AI_DATABASE_URL"] = _dsn_for(dsn, "ai_service", AI_SERVICE_PASSWORD)
    os.environ["AI_PROVIDER"] = "fake"
    from app.ai import config as ai_config
    from app.ai.db import Db
    from app.ai.pipeline import run_turn
    from app.ai.provider import FakeProvider
    from app.ai.runner import _DictionaryCache

    ai_config.ai_settings.cache_clear()
    settings = ai_config.ai_settings()

    async def go() -> None:
        db = Db(settings.database_url)
        try:
            while True:
                ctx = await db.one("select ai_private.exec_claim(%s)", ("membench",))
                if ctx is None:
                    return
                await run_turn(db, FakeProvider(), settings, await _DictionaryCache().get(db), ctx)
        finally:
            await db.close()

    asyncio.run(go())


def _literal(text: str) -> str:
    from app import fake_provider
    return "[" + ",".join(repr(x) for x in fake_provider.embed(text)) + "]"


def run_recall(dsn: str) -> dict:
    conn = psycopg.connect(dsn, autocommit=True)
    _sql(conn, f"alter role ai_service password '{AI_SERVICE_PASSWORD}'")
    cases = [json.loads(line) for line in (DATASETS / "memory.jsonl").read_text().splitlines() if line.strip()]
    tag = uuid.uuid4().hex[:8]
    uids: list[uuid.UUID] = []
    results = []
    try:
        for case in cases:
            uid = _make_member(conn, tag, case["id"])
            uids.append(uid)
            _submit(conn, uid, case["earlier"])
            _run_executor_once(dsn)
            earlier_msg = _sql(conn, "select body from ai_private.messages where owner_id = %s and role = 'member' "
                              "order by created_at limit 1", (uid,))[0][0]

            turn = _submit(conn, uid, case["later"])
            ctx = _sql(conn, "select ai_private.exec_claim(%s)", ("membench-claim",))[0][0]
            lease = ctx["lease"]
            keyword_only = _sql(conn, "select body from ai_private.exec_memory(%s, %s, %s, null)",
                                (turn, lease, case["later"]))
            hybrid = _sql(conn, "select body from ai_private.exec_memory(%s, %s, %s, %s)",
                         (turn, lease, case["later"], _literal(case["later"])))
            # release the lease the manual exec_claim took, and finish the
            # turn cleanly rather than leaving it claimed-but-abandoned.
            _sql(conn, "select ai_private.exec_finish(%s, %s, %s, %s)", (turn, lease, "cancelled", "test_cleanup"))

            kw_found = earlier_msg in [r[0] for r in keyword_only]
            hy_found = earlier_msg in [r[0] for r in hybrid]
            # keyword_found is informational only (expected to miss some
            # paraphrases — that is the whole point of adding the vector
            # leg); hybrid_correct is the real pass/fail, both directions:
            # a recall case must be found, a distractor must not be.
            results.append({"id": case["id"], "should_recall": case["should_recall"],
                           "keyword_found": kw_found, "hybrid_found": hy_found,
                           "hybrid_correct": hy_found == case["should_recall"]})
    finally:
        for batch_start in range(0, len(uids), 500):
            batch = uids[batch_start:batch_start + 500]
            _sql(conn, "delete from auth.users where id = any(%s)", (batch,))
        conn.close()

    recall_cases = [r for r in results if r["should_recall"]]
    distractor_cases = [r for r in results if not r["should_recall"]]
    return {
        "cases": results,
        "keyword_recall": round(sum(r["keyword_found"] for r in recall_cases) / len(recall_cases), 4) if recall_cases else None,
        "hybrid_recall": round(sum(r["hybrid_found"] for r in recall_cases) / len(recall_cases), 4) if recall_cases else None,
        "hybrid_distractor_precision": round(
            sum(not r["hybrid_found"] for r in distractor_cases) / len(distractor_cases), 4) if distractor_cases else None,
    }


def run_cost_benchmark(dsn: str, *, n: int = 10) -> dict:
    """Paired: the same message, same member, run once with
    use_chat_memory on and once off — the delta is memory_embedding's own
    reserved cost (it always runs when enabled, independent of whether
    anything is ever recalled)."""
    conn = psycopg.connect(dsn, autocommit=True)
    _sql(conn, f"alter role ai_service password '{AI_SERVICE_PASSWORD}'")
    tag = uuid.uuid4().hex[:8]
    uids: list[uuid.UUID] = []
    totals = {"memory_on": 0, "memory_off": 0}
    try:
        for i in range(n):
            for variant, on in (("memory_on", True), ("memory_off", False)):
                uid = _make_member(conn, tag, f"{variant}-{i}")
                uids.append(uid)
                _sql(conn, "update ai_private.member_settings set use_chat_memory = %s where member_id = %s",
                    (on, uid))
                turn = _submit(conn, uid, "python ninja")  # forces real model interpretation, see test_ai_faults.py
                _run_executor_once(dsn)
                cost = _sql(conn, "select coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0) "
                           "from ai_private.spend where turn_id = %s", (turn,))[0][0]
                totals[variant] += cost
    finally:
        for batch_start in range(0, len(uids), 500):
            batch = uids[batch_start:batch_start + 500]
            _sql(conn, "delete from auth.users where id = any(%s)", (batch,))
        conn.close()
    return {"n": n, "total_tokens_memory_on": totals["memory_on"], "total_tokens_memory_off": totals["memory_off"],
           "mean_tokens_memory_on": round(totals["memory_on"] / n, 1),
           "mean_tokens_memory_off": round(totals["memory_off"] / n, 1),
           "mean_memory_overhead_tokens": round((totals["memory_on"] - totals["memory_off"]) / n, 1)}


def run(dsn: str, *, out: Path | None = None) -> dict:
    report = {"recall": run_recall(dsn), "cost": run_cost_benchmark(dsn)}
    if out:
        out.write_text(json.dumps(report, indent=2))
    return report
