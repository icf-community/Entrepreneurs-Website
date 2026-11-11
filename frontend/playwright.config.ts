import { defineConfig, devices } from "@playwright/test";
import { storageStatePath } from "./e2e/fixtures";
import { PORT, BASE_URL, WEBKIT_PROXY_BASE_URL } from "./e2e/ports";

// ════════════════════════════════════════════════════════════════════
// Foundry · E2E (Playwright)
//
// Runs against a production `next start` build pointed at an EPHEMERAL
// Supabase that CI spins up (`supabase start`) and destroys after the run
// — so the full write workflow exercises real migrations/RLS/RPCs with
// zero prod contact and guaranteed cleanup. Locally it reuses an already-
// running dev/preview server if one is up.
//
// Env it expects at runtime (CI exports these from `supabase status`):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY (server actions + the seed in global-setup).
// ════════════════════════════════════════════════════════════════════

// gap 27: WebKit/Firefox/iPhone, opt-in via E2E_ALL_BROWSERS=1 — a normal
// run stays Chrome-only (CI time; gap 30). Cloned onto the plain UI-flow
// projects only: "ai"/"cv"/"matrix" each spin up their own fixed-port
// child processes (the AI executor, the CV gateway + Azurite, 385 role-
// matrix visits) in a spec-level beforeAll, not through project `use`, so
// tripling them would both port-conflict across projects and multiply an
// already-heavy run for no browser-specific signal; "ratelimit" stays
// single-browser and isolated to its own CI job as it already was.
const CROSS_BROWSER_BASE = ["public", "member", "admin", "pipelines", "connections"];
const CROSS_BROWSER_DEVICES: Record<string, (typeof devices)[keyof typeof devices]> = {
  webkit: devices["Desktop Safari"],
  firefox: devices["Desktop Firefox"],
  iphone: devices["iPhone 15"],
};

type ProjectDef = NonNullable<Parameters<typeof defineConfig>[0]["projects"]>[number];

function withCrossBrowser(baseProjects: ProjectDef[]): ProjectDef[] {
  if (process.env.E2E_ALL_BROWSERS !== "1") return baseProjects;
  const extra: ProjectDef[] = [];
  for (const base of baseProjects) {
    if (!CROSS_BROWSER_BASE.includes(base.name ?? "")) continue;
    for (const [suffix, device] of Object.entries(CROSS_BROWSER_DEVICES)) {
      // webkit/iphone (both WebKit) go through hstsStripProxy's self-signed
      // TLS endpoint instead of the real server directly — see that file
      // for why, and why that means trusting its cert here.
      const isWebkitEngine = suffix === "webkit" || suffix === "iphone";
      extra.push({
        ...base,
        name: `${base.name}-${suffix}`,
        use: {
          ...base.use,
          ...device,
          ...(isWebkitEngine ? { baseURL: WEBKIT_PROXY_BASE_URL, ignoreHTTPSErrors: true } : {}),
        },
      });
    }
  }
  return [...baseProjects, ...extra];
}

export default defineConfig({
  testDir: "./e2e",
  // Listing flows are stateful (submit -> approve -> appears), so keep the
  // suite serial and single-worker for deterministic ordering.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Seeds the ephemeral DB + writes per-role storageState before any spec.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: withCrossBrowser([
    // Logged-out surface + access control + auth entry flows.
    // Anchored on the e2e/ directory: unanchored, it also caught
    // adversarial/mobile-auth.spec.ts (which belongs to the adv-ui project and
    // forces a Pixel 7 = Chromium), so the WebKit/Firefox job tried to launch a
    // browser it does not install.
    { name: "public", testMatch: /[\\/]e2e[\\/](public|auth|health)\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    // Approved student session (from global-setup).
    {
      name: "member",
      testMatch: /optimistic-edits\.spec\.ts|member\.spec\.ts|double-submit\.spec\.ts|axe\.spec\.ts|resilience\.spec\.ts|loading\.spec\.ts|export\.spec\.ts|workflow\.spec\.ts|dialog\.spec\.ts|a11y\.spec\.ts|validation\.spec\.ts|urlfilters\.spec\.ts|home\.spec\.ts|community\.spec\.ts|github-showcase\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: storageStatePath("student") },
    },
    // Admin session.
    {
      name: "admin",
      testMatch: /admin\.spec\.ts|banner\.spec\.ts|intake\.spec\.ts|graduates\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: storageStatePath("admin") },
    },
    // Credential pipelines: email change, password change, password reset.
    // No storageState — these sign in and out as throwaway accounts they
    // create themselves, because what they assert on is whether a credential
    // moved, and that question cannot be asked from inside a session handed
    // to the test by global-setup.
    {
      name: "pipelines",
      testMatch: /pipelines\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Connections. No storageState: the round trip needs BOTH ends of a
    // handshake at once, so the spec opens each side's context explicitly
    // from the seeded connector/connectee states.
    {
      name: "connections",
      testMatch: /connections\.spec\.ts|notifications\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Foundry AI end to end (AI-plan §14.4, F32). The spec starts the
    // executor and the projection worker itself, with the fake provider,
    // against this run's local database, and switches the AI flags on only
    // for its own duration.
    {
      name: "ai",
      testMatch: /ai\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: storageStatePath("student") },
    },
    // CV upload through the real UI (AI-plan §14.4, gap 24). Opt-in via
    // E2E_CV_UPLOAD=1 (see scripts/local-env.sh) — the spec itself skips
    // with a clear message if the gateway env isn't set, rather than
    // hanging against a control the composer never rendered.
    {
      name: "cv",
      testMatch: /cv-upload(-hostile)?\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: storageStatePath("student") },
    },
    // Route × role matrix (AI-plan §14.4, gap 23). No storageState: the
    // spec opens its own context per role, including a bare one for
    // logged-out, so there is nothing for a project-level session to do.
    {
      name: "matrix",
      testMatch: /matrix\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Live rate-limit enforcement. Deliberately NOT run by the main e2e job
    // (which scopes to public/member/admin) — it only runs in the isolated
    // `e2e-ratelimit` CI job that wires Upstash via an SRH sidecar, so the
    // process-wide limiter can't make the rest of the suite flaky.
    //
    // To run this project locally: `scripts/perf/redis-up.sh`, then export
    // UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079 and
    // UPSTASH_REDIS_REST_TOKEN=perf-token *after* sourcing local-env.sh (it
    // blanks any *_URL/*_TOKEN it finds declared in .env.local, so setting
    // these before that source call is silently wiped). Without that, every
    // limiter is a no-op (see the startup log) and this project's tests fail
    // outright rather than flake — that's expected, not a regression.
    {
      name: "ratelimit",
      testMatch: /ratelimit\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ]),
  webServer: {
    // `-p ${PORT}` is not decoration: without it E2E_PORT moved only the URL
    // Playwright polled, while `next start` kept binding 3000 — so the one
    // documented escape hatch for "a dev server already holds 3000" failed
    // with EADDRINUSE and looked like the escape hatch not existing.
    // The binary directly, not `pnpm start`: pnpm swallows `-p` as its own
    // flag and `--` reaches next as a positional argument it reads as a
    // project directory. Either way the port never arrives.
    //
    // The env guard runs first, in PRODUCTION mode — `next start` reads
    // .env.production.local and .env.local, never .env.development.local, so
    // `pnpm dev`'s guard says nothing about what this server will connect to.
    // Without this line a local E2E run silently inherited .env.local's
    // PRODUCTION Upstash credentials and read and wrote the live cache; the
    // Supabase half was safe only because CI and the local runner both export
    // NEXT_PUBLIC_SUPABASE_URL into the process env, which outranks every file.
    //
    // NOT through pnpm. From pnpm 11.27.1, `pnpm exec` starts the command in
    // its own process group; Playwright stops the web server by killing the
    // group of the shell it spawned, so next-server survived, kept the
    // stdout pipe open, and every CI run passed its tests then hung until
    // GitHub's 6-hour cancel (the last green run used 11.27.0). `exec` the
    // package's own binary so the server IS the process Playwright started
    // and nothing sits in between to change how it is launched.
    command: `node scripts/assert-local-env.mjs --mode production && exec ./node_modules/.bin/next start -p ${PORT}`,
    url: BASE_URL,
    // `next start` is NODE_ENV=production, and since edf02c6 a production
    // process with no VERCEL_ENV counts as the real deployment
    // (productionEnv.ts): Turnstile refuses every form that has no secret
    // configured, which is every form here. A Vercel preview is the same
    // shape (production build, no abuse-control secrets), so say so.
    env: { VERCEL_ENV: "preview" },
    // Never reuse. `reuseExistingServer: !CI` looks like a local convenience
    // and is a trap: a server already on this port was built against whatever
    // env it was built with, and Playwright cannot tell. That happened —
    // a stale `next-server` pointed at PRODUCTION Supabase was silently reused
    // while global-setup seeded the local stack, so every authed test failed
    // on a JWT the prod project could not verify. 35 failures, none of them
    // real, and 14 minutes to find out.
    //
    // With this false, an occupied port is an immediate, obvious error instead
    // of a suite that runs against the wrong database. Stop your dev server
    // first, or set E2E_PORT.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
