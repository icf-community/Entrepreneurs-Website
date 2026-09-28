// ════════════════════════════════════════════════════════════════════
// Foundry · Local read/write measurement (launch programme E1c, M1–M3)
//
// For load-test optimisation on the laptop only. Off unless
// PERF_METRICS=1, which only the local load scripts set, and forced off in
// any Vercel deploy (VERCEL_ENV set) even if someone sets the flag there:
// the owner decided these metrics never run in prod.
//
// It wraps the server Supabase client's fetch, so every Auth call,
// PostgREST read and RPC write a page or server action makes is timed and
// labelled read / write / auth. Labels are route templates and
// table/RPC names only: never an id, a query string or a body.
// Lines go to frontend/.perf/metrics.jsonl (gitignored); nothing is sent
// anywhere. scripts/perf-summary.mjs turns them into plain-text numbers.
// ════════════════════════════════════════════════════════════════════

export type PerfKind = "read" | "write" | "auth" | "other";

export function perfEnabled(): boolean {
  return process.env.PERF_METRICS === "1" && !process.env.VERCEL_ENV;
}

// RPCs that only read. Anything else under /rpc/ is counted as a write,
// which errs toward "write-heavy" rather than hiding a write.
const READ_RPC = /^(list_|get_|my_|is_|count_|search_|home_|admin_list_|admin_get_|admin_profile_facets|connection_panel_state|connection_state_with|connection_consent_version|connections_enabled|connection_limit|listing_has_pending_edit|github_cv_ingestion_enabled|llm_job_budget_available)/;

export function classify(method: string, url: string): { kind: PerfKind; source: string } {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return { kind: "other", source: "unparsed" };
  }
  const auth = /^\/auth\/v1\/([a-z_]+)/.exec(path);
  if (auth) return { kind: "auth", source: `auth/${auth[1]}` };
  const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)/.exec(path);
  if (rpc) return { kind: READ_RPC.test(rpc[1]) ? "read" : "write", source: `rpc/${rpc[1]}` };
  const table = /^\/rest\/v1\/([a-z0-9_]+)/.exec(path);
  if (table) {
    const m = method.toUpperCase();
    return { kind: m === "GET" || m === "HEAD" ? "read" : "write", source: table[1] };
  }
  return { kind: "other", source: path.split("/").slice(0, 3).join("/") };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A route label with ids and query strings removed. */
export function routeTemplate(path: string | null | undefined): string {
  if (!path) return "unknown";
  return path.split("?")[0].replace(UUID, ":id").replace(/\/\d+(?=\/|$)/g, "/:id");
}

type Line = { ts: number; route: string; kind: PerfKind; source: string; method: string; status: number; ms: number };

let dirReady: Promise<void> | null = null;

async function write(line: Line): Promise<void> {
  try {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), ".perf");
    dirReady ??= mkdir(dir, { recursive: true }).then(() => undefined);
    await dirReady;
    await appendFile(join(dir, "metrics.jsonl"), JSON.stringify(line) + "\n");
  } catch {
    // Measurement must never affect the request it measures.
  }
}

/** Wrap a fetch so each call is timed; the original when disabled. */
export function withPerf(inner: typeof fetch, route: string | null | undefined): typeof fetch {
  if (!perfEnabled()) return inner;
  const routeLabel = routeTemplate(route);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    const { kind, source } = classify(method, url);
    const start = performance.now();
    let status = 0;
    try {
      const res = await inner(input, init);
      status = res.status;
      return res;
    } finally {
      void write({ ts: Date.now(), route: routeLabel, kind, source, method, status, ms: Math.round((performance.now() - start) * 10) / 10 });
    }
  }) as typeof fetch;
}
