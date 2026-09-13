#!/usr/bin/env python3
"""B2.8 — CV/GitHub ingestion pipeline load test.

Drains a queue of synthetic `scan_github` jobs through REAL
`python -m app.worker` subprocesses (not in-process function calls, unlike
the C1 audit) — the thing under test is the claim/dispatch path itself
(`for update skip locked`, graceful SIGTERM drain, the stalled-job reaper)
under real process concurrency, not the pipeline's judgment quality.

Two things are stubbed, deliberately, and only here:

  * GitHub's HTTP API — a local mock server (this file) serves synthetic
    repo listings/READMEs, keyed by a per-connection bearer token. Reached
    via `GITHUB_API_BASE`, the one-line override added to
    app/github_pipeline.py for exactly this harness.
  * OpenAI — real calls would be real spend (500 connections x 2-3 calls
    each) and would measure OpenAI's own rate limits, not this worker's
    concurrency. `OPENAI_STUB_LATENCY_SECONDS` (app/openai_client.py)
    sleeps a fixed duration and returns a canned, schema-conformant,
    fail-open response instead. That constant is identical across the 1-
    and 3-instance runs, so the *comparison* between them stays honest.

Everything else is real: real Postgres, real `for update skip locked`
contention, real worker subprocess startup/shutdown, real
`reap_stalled_jobs()`.

Usage (from server/, with the venv active, local Supabase running, and
DATABASE_URL/GITHUB_TOKEN_ENCRYPTION_KEY/OPENAI_API_KEY/AZURE_STORAGE_ACCOUNT/
AZURE_CV_CONTAINER set — loaded from .env.worker.local if not already in the
environment, same as c1_audit_run.py):

    python scripts/b28_load_test.py compare --count 500
    python scripts/b28_load_test.py run --count 20 --instances 1   # smoke test
    python scripts/b28_load_test.py reap-test
    python scripts/b28_load_test.py cleanup

See ~/.claude/plans/velvety-weaving-dijkstra.md, "Phase 5 — B2.8" and
docs/audits/B2-pipeline-load-test-findings.md for the audit this feeds.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import random
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from dotenv import dotenv_values  # noqa: E402

_env_file = SERVER_ROOT / ".env.worker.local"
if _env_file.exists():
    for key, value in dotenv_values(_env_file).items():
        if value is not None:
            os.environ.setdefault(key, value)

import psycopg  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

LOADTEST_EMAIL_DOMAIN = "b28-loadtest.invalid"
STUB_LATENCY_SECONDS = 1.2  # C1 audit's own measured average: 157s / 132 calls
LANGS = ["Python", "TypeScript", "Go", "Rust", "Java", "C++", "Ruby", "Kotlin"]
REQUIRED_ENV = [
    "DATABASE_URL",
    "GITHUB_TOKEN_ENCRYPTION_KEY",
    "OPENAI_API_KEY",
    "AZURE_STORAGE_ACCOUNT",
    "AZURE_CV_CONTAINER",
]


# ─── synthetic fixtures ─────────────────────────────────────────────────
def _repo(prefix: str, i: int) -> dict:
    lang = LANGS[i % len(LANGS)]
    return {
        "name": f"{prefix}-proj-{i:03d}",
        "full_name": f"{prefix}/{prefix}-proj-{i:03d}",
        "html_url": f"https://github.com/{prefix}/{prefix}-proj-{i:03d}",
        "description": f"A {lang} project used for the B2.8 load test." if i % 4 else None,
        "language": lang,
        "stargazers_count": i % 6,
        "forks_count": i % 3,
        "size": 50 + (i % 40) * 10,
        "fork": False,
        "pushed_at": f"2026-{(i % 12) + 1:02d}-{(i % 27) + 1:02d}T00:00:00Z",
    }


def build_connections(count: int) -> list[dict]:
    """~90% light (5-30 repos), ~10% heavy tail (100-300) — matches B2.6's
    own worst-case shape rather than a uniform distribution, since a real
    membership is mostly small accounts with a handful of prolific ones."""
    rng = random.Random(20260912)
    heavy_count = max(1, count // 10)
    connections = []
    for i in range(count):
        username = f"b28-user-{i:04d}"
        is_heavy = i >= count - heavy_count
        repo_count = rng.randint(100, 300) if is_heavy else rng.randint(5, 30)
        repos = [_repo(username, j) for j in range(repo_count)]
        connections.append(
            {
                "member_id": uuid.uuid4(),
                "github_user_id": 900_000_000 + i,
                "username": username,
                "token": f"b28-token-{i:04d}-{uuid.uuid4().hex[:8]}",
                "repos": repos,
                "readmes": {
                    repo["full_name"]: f"# {repo['name']}\n\nA real-shaped README body for load-test repo {j}."
                    for j, repo in enumerate(repos)
                    if j % 5 == 0
                },
                "profile_readme": (
                    "Building things end to end, mostly backend and data work." if i % 10 == 0 else None
                ),
            }
        )
    return connections


# ─── mock GitHub HTTP server ────────────────────────────────────────────
class _MockGithubHandler(http.server.BaseHTTPRequestHandler):
    connections_by_token: dict[str, dict] = {}
    readmes_by_full_name: dict[str, str] = {}
    # Diagnostics, not live print()s: a background daemon thread's stdout
    # can interleave unreliably with the main thread's, so unmatched-token
    # events are recorded here and reported once, after the run, instead.
    unmatched_tokens: list[str] = []

    def log_message(self, fmt: str, *args: object) -> None:  # silence per-request noise
        pass

    def _token(self) -> str | None:
        auth = self.headers.get("Authorization", "")
        return auth[len("Bearer ") :] if auth.startswith("Bearer ") else None

    def _send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, status: int, text: str) -> None:
        body = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)

        if path == "/user/repos":
            token = self._token()
            conn = self.connections_by_token.get(token)
            if conn is None:
                self.unmatched_tokens.append(f"{token!r} (known: {len(self.connections_by_token)} tokens)")
                self._send_json(401, {"message": "Bad credentials"})
                return
            page = int(query.get("page", ["1"])[0])
            per_page = int(query.get("per_page", ["100"])[0])
            start = (page - 1) * per_page
            self._send_json(200, conn["repos"][start : start + per_page])
            return

        if path.startswith("/repos/") and path.endswith("/readme"):
            full_name = path[len("/repos/") : -len("/readme")]
            conn = self.connections_by_token.get(self._token())
            profile_key = f"{conn['username']}/{conn['username']}" if conn else None
            if conn is not None and full_name == profile_key:
                if conn["profile_readme"] is not None:
                    self._send_text(200, conn["profile_readme"])
                else:
                    self._send_json(404, {"message": "Not Found"})
                return
            body = self.readmes_by_full_name.get(full_name)
            if body is not None:
                self._send_text(200, body)
            else:
                self._send_json(404, {"message": "Not Found"})
            return

        self._send_json(404, {"message": "Not Found"})


def start_mock_server(connections: list[dict]):
    handler_cls = type("BoundMockGithubHandler", (_MockGithubHandler,), {})
    handler_cls.connections_by_token = {c["token"]: c for c in connections}
    handler_cls.readmes_by_full_name = {}
    handler_cls.unmatched_tokens = []
    for c in connections:
        handler_cls.readmes_by_full_name.update(c["readmes"])

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    return server, f"http://127.0.0.1:{port}", handler_cls


# ─── database seed / cleanup ────────────────────────────────────────────
def seed(conn: psycopg.Connection, connections: list[dict], encryption_key: str) -> None:
    with conn.cursor() as cur:
        for c in connections:
            cur.execute(
                """
                insert into auth.users
                    (id, email, raw_user_meta_data, raw_app_meta_data,
                     confirmation_token, recovery_token, email_change_token_new)
                values (%s, %s, %s, %s, '', '', '')
                """,
                (
                    c["member_id"],
                    f"{c['username']}@{LOADTEST_EMAIL_DOMAIN}",
                    Jsonb({"first_name": "B28", "surname": "Loadtest", "role": "alum", "grad_year": 2020}),
                    Jsonb({"provider": "email"}),
                ),
            )
            cur.execute(
                """
                insert into public.profiles (id, role, first_name, surname, grad_year)
                values (%s, 'alum', 'B28', 'Loadtest', 2020)
                on conflict (id) do nothing
                """,
                (c["member_id"],),
            )
            cur.execute(
                """
                insert into public.github_connections
                    (member_id, github_user_id, github_username, access_token_encrypted,
                     scan_status, connected_at)
                values (%s, %s, %s, extensions.pgp_sym_encrypt(%s, %s), 'pending', now())
                """,
                (c["member_id"], c["github_user_id"], c["username"], c["token"], encryption_key),
            )
            cur.execute(
                "insert into public.jobs (kind, payload, status) values ('scan_github', %s, 'pending')",
                (Jsonb({"member_id": str(c["member_id"])}),),
            )
    conn.commit()


def cleanup(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute("select id from auth.users where email like %s", (f"%@{LOADTEST_EMAIL_DOMAIN}",))
        member_ids = [row[0] for row in cur.fetchall()]
        if not member_ids:
            return 0
        cur.execute(
            "delete from public.jobs where kind = 'scan_github' and (payload->>'member_id')::uuid = any(%s)",
            (member_ids,),
        )
        # auth.users -> profiles -> github_connections all cascade on delete.
        cur.execute("delete from auth.users where id = any(%s)", (member_ids,))
    conn.commit()
    return len(member_ids)


def scan_outcome_counts(conn: psycopg.Connection, member_ids: list) -> dict:
    """Job status ('done') only proves the queue processed the row without
    raising — it does NOT prove the scan itself succeeded (a caught
    GithubScanError still lets process_scan_github return normally, so the
    job is 'done' either way). This checks the actual pipeline outcome
    (github_connections.scan_status) so a silent failure mode can't hide
    behind a clean-looking job-queue result."""
    with conn.cursor() as cur:
        cur.execute(
            "select scan_status, count(*) from public.github_connections where member_id = any(%s) group by scan_status",
            (member_ids,),
        )
        counts = dict(cur.fetchall())
        cur.execute(
            """
            select scan_failure_reason, count(*) from public.github_connections
             where member_id = any(%s) and scan_status = 'failed'
             group by scan_failure_reason
            """,
            (member_ids,),
        )
        failure_reasons = dict(cur.fetchall())
    return {"by_status": counts, "failure_reasons": failure_reasons}


def status_counts(conn: psycopg.Connection, member_ids: list) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select status, count(*) from public.jobs
             where kind = 'scan_github' and (payload->>'member_id')::uuid = any(%s)
             group by status
            """,
            (member_ids,),
        )
        return dict(cur.fetchall())


# ─── worker subprocess orchestration ────────────────────────────────────
def launch_workers(n: int, *, github_api_base: str, log_dir: Path) -> list[tuple]:
    python_bin = SERVER_ROOT / "venv" / "bin" / "python"
    if not python_bin.exists():
        raise SystemExit(f"no venv at {python_bin} — see server/README.md")
    log_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["GITHUB_API_BASE"] = github_api_base
    env["OPENAI_STUB_LATENCY_SECONDS"] = str(STUB_LATENCY_SECONDS)

    procs = []
    for i in range(1, n + 1):
        log_path = log_dir / f"worker-{i}.log"
        log_file = open(log_path, "w")
        proc = subprocess.Popen(
            [str(python_bin), "-m", "app.worker"],
            cwd=str(SERVER_ROOT),
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        procs.append((i, proc, log_file, log_path))
    return procs


def stop_workers(procs: list[tuple], *, timeout: float = 120) -> None:
    for _, proc, log_file, _ in procs:
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
    for _, proc, log_file, _ in procs:
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        log_file.close()


def wait_for_drain(conn: psycopg.Connection, member_ids: list, *, timeout: float, poll: float = 1.0):
    start = time.time()
    while True:
        counts = status_counts(conn, member_ids)
        outstanding = counts.get("pending", 0) + counts.get("running", 0)
        elapsed = time.time() - start
        if outstanding == 0:
            return elapsed, counts
        if elapsed > timeout:
            return elapsed, counts
        time.sleep(poll)


# ─── commands ────────────────────────────────────────────────────────────
def cmd_run(args: argparse.Namespace) -> None:
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)
    n_cleaned = cleanup(conn)
    if n_cleaned:
        print(f"cleaned up {n_cleaned} leftover load-test member(s) from a prior run")

    print(f"building {args.count} synthetic connections ({max(1, args.count // 10)} heavy)...")
    connections = build_connections(args.count)
    member_ids = [c["member_id"] for c in connections]

    print("seeding database...")
    t0 = time.time()
    seed(conn, connections, os.environ["GITHUB_TOKEN_ENCRYPTION_KEY"])
    print(f"  seeded in {time.time() - t0:.1f}s")

    server, base_url, handler_cls = start_mock_server(connections)
    print(f"mock GitHub server on {base_url}")

    log_dir = Path(args.log_dir) / f"instances-{args.instances}"
    print(f"launching {args.instances} worker instance(s), logs at {log_dir}")
    procs = launch_workers(args.instances, github_api_base=base_url, log_dir=log_dir)

    if args.kill_one_after:
        time.sleep(args.kill_one_after)
        victim = procs[0]
        print(f"sending SIGTERM to instance {victim[0]} (pid {victim[1].pid}) mid-run...")
        victim[1].send_signal(signal.SIGTERM)

    elapsed, counts = wait_for_drain(conn, member_ids, timeout=args.timeout)
    print(f"\ndrain finished (or timed out) after {elapsed:.1f}s")
    print(f"status counts: {counts}")

    stop_workers(procs)
    server.shutdown()

    if handler_cls.unmatched_tokens:
        print(f"\n{len(handler_cls.unmatched_tokens)} request(s) hit the mock server with an "
              f"unrecognised token — first few: {handler_cls.unmatched_tokens[:5]}")
    else:
        print("\nmock server: every /user/repos request presented a recognised token")

    total = sum(counts.values())
    done = counts.get("done", 0)
    print(f"\n{done}/{total} done, {counts.get('dead', 0)} dead-lettered, "
          f"{counts.get('pending', 0)} still pending, {counts.get('running', 0)} still running")

    if args.kill_one_after:
        victim_log = procs[0][3].read_text()
        graceful = "finishing current job then exiting" in victim_log and "worker stopped cleanly" in victim_log
        print(f"\nSIGTERM'd instance {'drained gracefully' if graceful else 'did NOT show a clean graceful-drain log line — check ' + str(procs[0][3])}")

    # Checked BEFORE cleanup, and separately from the job-queue's own
    # 'done' count: a job can be 'done' (process_scan_github returned
    # without raising) while the scan itself still failed internally
    # (a caught GithubScanError). This is what would surface a silent
    # mock-server/token mismatch instead of it hiding behind a clean-
    # looking queue result.
    outcome = scan_outcome_counts(conn, member_ids)
    print(f"\nscan outcome (github_connections.scan_status): {outcome['by_status']}")
    if outcome["failure_reasons"]:
        print(f"failure reasons: {outcome['failure_reasons']}")

    if not args.keep:
        cleanup(conn)
        print("\ncleaned up load-test rows")

    result = {
        "count": args.count,
        "instances": args.instances,
        "elapsed_seconds": round(elapsed, 1),
        "status_counts": counts,
        "scan_outcome": outcome,
        "timed_out": elapsed > args.timeout,
    }
    print(f"\nRESULT_JSON {json.dumps(result)}")


def cmd_reap_test(args: argparse.Namespace) -> None:
    """Two checks, combined because neither alone is the full story:

    1. A genuine SIGKILL (not SIGTERM) really does strand a claimed job in
       'running' with no automatic recovery — proving the failure mode
       reap_stalled_jobs() exists for is real, not hypothetical.
    2. reap_stalled_jobs() only reclaims a 'running' row past the 15-minute
       threshold, checked via a row inserted directly with a backdated
       `updated_at` (INSERT, not UPDATE — jobs_set_updated_at only fires
       on UPDATE, so this is the one way to get a genuinely-old timestamp
       on the row without waiting 15 real minutes) — and leaves a
       freshly-stranded row (from check 1, seconds old) untouched, which is
       the correct behaviour for a job that might still be legitimately
       mid-flight.
    """
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)
    cleanup(conn)

    connections = build_connections(1)
    member_ids = [c["member_id"] for c in connections]
    seed(conn, connections, os.environ["GITHUB_TOKEN_ENCRYPTION_KEY"])

    server, base_url, _handler_cls = start_mock_server(connections)
    log_dir = Path(args.log_dir) / "reap-test"
    procs = launch_workers(1, github_api_base=base_url, log_dir=log_dir)

    print("waiting for the one job to be claimed (status='running')...")
    start = time.time()
    while True:
        counts = status_counts(conn, member_ids)
        if counts.get("running", 0) == 1:
            break
        if time.time() - start > 30:
            raise SystemExit(f"job never reached 'running' within 30s — counts: {counts}")
        time.sleep(0.2)

    pid = procs[0][1].pid
    print(f"job claimed — SIGKILL-ing worker pid {pid} (disorderly death, no graceful drain)")
    procs[0][1].kill()
    procs[0][1].wait()
    procs[0][2].close()

    counts_after_kill = status_counts(conn, member_ids)
    genuinely_stranded = counts_after_kill.get("running", 0) == 1
    print(f"after SIGKILL: {counts_after_kill} -> genuinely stranded in 'running': {genuinely_stranded}")

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.jobs (kind, payload, status, attempts, updated_at)
            values ('scan_github', %s, 'running', 0, now() - interval '16 minutes')
            returning id
            """,
            (Jsonb({"member_id": str(uuid.uuid4())}),),
        )
        backdated_job_id = cur.fetchone()[0]

    with conn.cursor() as cur:
        cur.execute("select public.reap_stalled_jobs()")
        reaped_count = cur.fetchone()[0]

    with conn.cursor() as cur:
        cur.execute("select status from public.jobs where id = %s", (backdated_job_id,))
        backdated_status = cur.fetchone()[0]
        cur.execute(
            "select status from public.jobs where kind='scan_github' and (payload->>'member_id')::uuid = any(%s)",
            (member_ids,),
        )
        real_stranded_status = cur.fetchone()[0]

    server.shutdown()
    with conn.cursor() as cur:
        cur.execute("delete from public.jobs where id = %s", (backdated_job_id,))
    cleanup(conn)

    print(f"\nreap_stalled_jobs() reaped {reaped_count} row(s) this call")
    print(f"backdated (16min-old) row status after reap: {backdated_status} (expect 'pending')")
    print(f"genuinely-SIGKILL-stranded row (seconds old) status after reap: {real_stranded_status} (expect still 'running' — too fresh to reap)")

    ok = (
        genuinely_stranded
        and reaped_count >= 1
        and backdated_status == "pending"
        and real_stranded_status == "running"
    )
    print(f"\nREAP_TEST_{'PASS' if ok else 'FAIL'}")


def cmd_cleanup(_: argparse.Namespace) -> None:
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)
    n = cleanup(conn)
    print(f"cleaned up {n} load-test member(s)")


def cmd_compare(args: argparse.Namespace) -> None:
    for instances in (1, 3):
        print(f"\n{'=' * 60}\nRUN: {instances} instance(s), {args.count} jobs\n{'=' * 60}")
        run_args = argparse.Namespace(
            count=args.count,
            instances=instances,
            timeout=args.timeout,
            log_dir=args.log_dir,
            keep=False,
            kill_one_after=args.kill_one_after if instances == 3 else None,
        )
        cmd_run(run_args)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="seed N jobs, drain with K worker instances, report elapsed time")
    p_run.add_argument("--count", type=int, default=500)
    p_run.add_argument("--instances", type=int, default=1)
    p_run.add_argument("--timeout", type=float, default=1800)
    p_run.add_argument("--log-dir", default="/tmp/b28_load_test_logs")
    p_run.add_argument("--keep", action="store_true", help="don't clean up rows after the run")
    p_run.add_argument("--kill-one-after", type=float, default=None, help="SIGTERM one instance N seconds in")
    p_run.set_defaults(func=cmd_run)

    p_compare = sub.add_parser("compare", help="run the full 1-instance then 3-instance comparison")
    p_compare.add_argument("--count", type=int, default=500)
    p_compare.add_argument("--timeout", type=float, default=1800)
    p_compare.add_argument("--log-dir", default="/tmp/b28_load_test_logs")
    p_compare.add_argument("--kill-one-after", type=float, default=15)
    p_compare.set_defaults(func=cmd_compare)

    p_reap = sub.add_parser("reap-test", help="verify reap_stalled_jobs() + a real SIGKILL stranding")
    p_reap.add_argument("--log-dir", default="/tmp/b28_load_test_logs")
    p_reap.set_defaults(func=cmd_reap_test)

    p_cleanup = sub.add_parser("cleanup", help="delete any leftover load-test rows")
    p_cleanup.set_defaults(func=cmd_cleanup)

    args = parser.parse_args()

    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        raise SystemExit(f"missing required env vars: {missing} (set them or check .env.worker.local)")

    args.func(args)


if __name__ == "__main__":
    main()
