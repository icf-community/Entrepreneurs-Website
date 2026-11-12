import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

// ════════════════════════════════════════════════════════════════════
// Foundry AI · the two background processes the AI spec needs (AI-plan
// §14.4, F32): the executor (python -m app.ai) and the existing worker
// limited to projection jobs (python -m app.worker), both with the FAKE
// provider. The fake refuses any database that is not on this machine,
// and E2E_DB_URL comes from `supabase status`, never .env.local.
// ════════════════════════════════════════════════════════════════════

const SERVER = join(__dirname, "..", "..", "server");
const PYTHON = process.env.E2E_PYTHON ?? join(SERVER, "venv", "bin", "python");
const AI_PASSWORD = "ai_service-local";
const WORKER_PASSWORD = "cv_worker-local";

function dbUrl(): string {
  const url = process.env.E2E_DB_URL;
  if (!url) throw new Error("E2E_DB_URL is not set — run through scripts/e2e-local.sh (or export DB_URL from supabase status).");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`AI E2E refuses to run against ${host}`);
  return url;
}

function asRole(role: string, password: string): string {
  const u = new URL(dbUrl());
  u.username = role;
  u.password = password;
  u.searchParams.set("sslmode", "disable");
  return u.toString();
}

// SQL through the server's own venv (psycopg), so the spec needs nothing
// the executor doesn't. Prints the last statement's rows, tab-separated.
const RUN_SQL = `
import sys, psycopg
with psycopg.connect(sys.argv[1], autocommit=True) as c:
    cur = c.execute(sys.argv[2])
    if cur.description:
        for row in cur.fetchall():
            print("\t".join("" if v is None else str(v) for v in row))
`;

export function psql(sql: string): string {
  return execFileSync(PYTHON, ["-c", RUN_SQL, dbUrl(), sql], { encoding: "utf8" });
}

export function setAiFlags(on: boolean): void {
  psql(`update public.app_config set value = '${on ? "true" : "false"}'
         where key in ('ai_enabled', 'ai_recruiter_enabled', 'ai_network_enabled', 'ai_opportunities_enabled')`);
}

export function startAiServices(): () => void {
  psql(`alter role ai_service password '${AI_PASSWORD}'; alter role cv_worker password '${WORKER_PASSWORD}';`);
  const common = { ...process.env, PYTHONUNBUFFERED: "1", SENTRY_DSN: "" };
  const procs: ChildProcess[] = [
    spawn(PYTHON, ["-m", "app.ai"], {
      cwd: SERVER,
      env: { ...common, AI_DATABASE_URL: asRole("ai_service", AI_PASSWORD), AI_PROVIDER: "fake", AI_WORKERS: "2" },
      stdio: ["ignore", "inherit", "inherit"],
    }),
    spawn(PYTHON, ["-m", "app.worker"], {
      cwd: SERVER,
      env: {
        ...common,
        DATABASE_URL: asRole("cv_worker", WORKER_PASSWORD),
        OPENAI_PROVIDER: "fake",
        WORKER_JOB_KINDS: "refresh_member_ai,refresh_job_ai",
        // Required by worker_settings(); unused by projection jobs.
        OPENAI_API_KEY: "unused",
        GITHUB_TOKEN_ENCRYPTION_KEY: "unused",
        AZURE_CV_CONTAINER: "unused",
        AZURE_STORAGE_ACCOUNT: "unused",
        GITHUB_OAUTH_CLIENT_ID: "unused",
        GITHUB_OAUTH_CLIENT_SECRET: "unused",
      },
      stdio: ["ignore", "inherit", "inherit"],
    }),
  ];
  return () => {
    for (const p of procs) p.kill("SIGTERM");
  };
}

/**
 * SIGTERM is not synchronous: the executor finishes its current poll before
 * it exits, and in that window it can still claim a turn queued a moment
 * after the stop. A test that needs "no executor" waits for the ai_service
 * database role to hold no connections, which is what the executor's exit
 * actually looks like from the database.
 */
export async function waitForExecutorGone(timeoutMs = 20_000): Promise<void> {
  await waitFor(
    () => psql("select count(*) from pg_stat_activity where usename = 'ai_service'").trim() === "0",
    "the AI executor to exit",
    timeoutMs,
  );
}

/** Waits until the worker has built the projections the spec relies on. */
export async function waitFor(check: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}
