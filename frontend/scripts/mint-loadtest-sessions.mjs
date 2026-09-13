#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Foundry · Mint signed-in sessions for the k6 load test
//
//   export $(supabase status -o env | xargs)   # or set the three vars below
//   node frontend/scripts/mint-loadtest-sessions.mjs
//   COUNT=20 node frontend/scripts/mint-loadtest-sessions.mjs
//
// Writes frontend/scripts/.loadtest-sessions.json (gitignored), which
// loadtest.js reads in MODE=auth / MODE=mixed.
//
// ──────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
// ──────────────────────────────────────────────────────────────────────
// The 2026-09-08 audit ran k6 anonymously, so every hit on /events and
// /opportunities was a 3xx to /login — `expected_redirect` counted them
// honestly, but it means the listing boards' RENDER cost under
// concurrency has never been measured. Their queries were measured
// (2.2 ms and 10.2 ms in scale_query_plans.sql); the pages around those
// queries were not. This closes that gap, and it is the measurement that
// decides whether B3.3's RPC split is worth its risk.
//
// ──────────────────────────────────────────────────────────────────────
// WHY 20 SESSIONS AND NOT 500
// ──────────────────────────────────────────────────────────────────────
// config.toml sets `sign_in_sign_ups = 30` per 5 minutes per IP, so
// minting one session per VU is not merely slow, it is impossible — the
// mint would spend seventeen minutes being rate-limited and then measure
// the limiter. It is also unnecessary: nothing on these read paths is
// cached per member (cache.ts holds only the directory and taxonomy
// keys, both caller-independent), the app is `force-dynamic`, and RLS
// plan shape does not vary by `auth.uid()`. A handful of distinct
// members is enough to avoid the one artefact that WOULD matter — a
// single uid whose plans and pages are unrealistically warm.
//
// If you raise COUNT past ~25, raise `sign_in_sign_ups` in config.toml
// for the run and put it back afterwards; do not leave it raised, the
// E2E rate-limit spec asserts against these numbers.
//
// ──────────────────────────────────────────────────────────────────────
// WHICH MEMBERS ARE ELIGIBLE
// ──────────────────────────────────────────────────────────────────────
// Not "any corpus row". seed_scale_corpus.sql deliberately does NOT make
// everyone approved — `rn % 20`, `% 37` and `% 97` are left
// pending_review / pending_onboarding / rejected so the directory's
// status filter keeps its selectivity. Signing in as one of those
// measures a redirect to /pending, which is the exact mistake this
// script exists to stop repeating. `intake_completed_at` matters for the
// same reason: /home passes bounceToIntake, so a member without it is
// redirected to /intake.
//
// Corpus emails are also NOT guessable. Step 2 of the seed rewrites
// students to `scaleN.scale.invalid@imperial.ac.uk` to satisfy the
// Imperial-domain trigger, leaving everyone else on `scaleN@scale.invalid`.
// So the address is read back from auth.users rather than constructed.
// ════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), ".loadtest-sessions.json");

/** Every corpus row is seeded with this bcrypt'd password. */
const CORPUS_PASSWORD = "not-a-real-password";
const CORPUS_MARKER = "scale.invalid";
const COUNT = Number(process.env.COUNT || 20);

/** Sign-ins run in small batches: concurrent enough to be quick, small
 *  enough that a 429 is caught before dozens more are in flight. */
const BATCH = 5;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !serviceKey) {
  fail(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY " +
      "must be set. Export them from `supabase status -o env` — NOT from .env.local, which " +
      "holds the production project.",
  );
}

assertEphemeral(url);

/**
 * Refuses to run against anything but a local Supabase.
 *
 * This signs in as real accounts and writes their access tokens to a
 * file on disk. Against the local corpus those accounts are fixtures;
 * against a hosted project they would be members, and the file would be
 * a stack of live production session tokens sitting in the working tree.
 *
 * Allow-list, not a deny-list, and identical in spirit to the guard in
 * e2e/global-setup.ts — for the same reason it exists there. `.env.local`
 * holds the PRODUCTION url and exporting it is a one-line mistake that
 * looks exactly like the correct command ([[env-local-points-at-prod]]).
 */
function assertEphemeral(target) {
  const host = new URL(target).hostname;
  const local =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "host.docker.internal" ||
    host.endsWith(".local");
  if (local) return;
  fail(
    `refuses to run against ${host}. This mints and writes session tokens to disk, so it may ` +
      "only ever point at a local Supabase — never a hosted project.",
  );
}

function fail(message) {
  console.error(`mint-loadtest-sessions: ${message}`);
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── 1. Corpus id → email. ────────────────────────────────────────────
// auth.users is not reachable through PostgREST, so the addresses come
// from the admin API. Paged rather than perPage=5000 because GoTrue caps
// the page size server-side and silently returns fewer.
async function corpusEmails() {
  const byId = new Map();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      // A corpus row with NULL token columns takes this call out for the
      // WHOLE table, not just that row ([[gotrue-null-token-columns]]).
      fail(
        `listUsers failed: ${error.message}. If this says "Database error finding users", a ` +
          "hand-inserted auth.users row has NULL token columns — they must be '' not NULL.",
      );
    }
    for (const u of data.users) {
      if (u.email?.includes(CORPUS_MARKER)) byId.set(u.id, u.email);
    }
    if (data.users.length < 1000) break;
  }
  return byId;
}

// ── 2. Eligible profiles. ────────────────────────────────────────────
async function eligibleIds() {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("status", "approved")
    .not("intake_completed_at", "is", null)
    .order("id")
    .limit(500);
  if (error) fail(`profiles select failed: ${error.message}`);
  return data.map((r) => r.id);
}

// ── 3. Session → the exact @supabase/ssr cookies. ────────────────────
// Let the library write them into a capturing jar rather than
// hand-rolling `sb-<ref>-auth-token`: the name, the base64 encoding and
// the >3KB chunking are all library internals that have changed before,
// and the app must be handed the bytes it would have set itself. Same
// technique as e2e/global-setup.ts, which is the proof it works.
async function sessionCookies(session) {
  const jar = [];
  const ssr = createServerClient(url, anon, {
    cookies: {
      getAll: () => jar.map((c) => ({ name: c.name, value: c.value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          const i = jar.findIndex((c) => c.name === name);
          if (i >= 0) jar[i].value = value;
          else jar.push({ name, value });
        }
      },
    },
  });
  await ssr.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return jar;
}

async function mint(email) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: CORPUS_PASSWORD,
  });
  if (error || !data.session) {
    const message = error?.message ?? "no session returned";
    if (/rate limit|too many/i.test(message)) {
      fail(
        `rate-limited after signing in some accounts: ${message}. config.toml allows ` +
          "`sign_in_sign_ups = 30` per 5 minutes per IP — wait five minutes, or lower COUNT.",
      );
    }
    fail(`sign-in ${email}: ${message}`);
  }
  const cookies = await sessionCookies(data.session);
  return {
    email,
    userId: data.session.user.id,
    // Pre-joined so the load test does no string work in the hot path.
    cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    expiresAt: data.session.expires_at,
  };
}

const emails = await corpusEmails();
if (emails.size === 0) {
  fail(
    "no @scale.invalid accounts found. Seed the corpus first:\n" +
      "  docker exec -i supabase_db_EntrepreneursWebsite psql -U postgres -d postgres \\\n" +
      "    -v ON_ERROR_STOP=1 < supabase/snippets/seed_scale_corpus.sql",
  );
}

const eligible = (await eligibleIds()).filter((id) => emails.has(id)).slice(0, COUNT);
if (eligible.length === 0) {
  fail(
    `found ${emails.size} corpus accounts but none that are approved with intake completed. ` +
      "Signing in as those would measure a redirect to /pending or /intake, not a rendered page.",
  );
}
if (eligible.length < COUNT) {
  console.warn(
    `mint-loadtest-sessions: only ${eligible.length} eligible members (asked for ${COUNT}).`,
  );
}

const sessions = [];
for (let i = 0; i < eligible.length; i += BATCH) {
  const slice = eligible.slice(i, i + BATCH);
  const minted = await Promise.all(slice.map((id) => mint(emails.get(id))));
  sessions.push(...minted);
  process.stdout.write(`\rminted ${sessions.length}/${eligible.length}`);
}
process.stdout.write("\n");

// The soonest expiry is what the load test has to finish inside. Local
// GoTrue issues one-hour tokens and a full ramp is ~3.5 minutes, so this
// is a sanity line rather than a real constraint — but a stale file that
// silently turns every authenticated hit back into a redirect is exactly
// the failure this whole exercise is correcting, so it is recorded and
// the load test re-checks it.
const soonest = Math.min(...sessions.map((s) => s.expiresAt));

writeFileSync(
  OUT,
  `${JSON.stringify({ mintedAt: Math.floor(Date.now() / 1000), soonestExpiry: soonest, sessions }, null, 2)}\n`,
);

console.log(
  `wrote ${sessions.length} sessions to ${OUT}\n` +
    `valid for ~${Math.round((soonest - Date.now() / 1000) / 60)} min — run k6 now:\n` +
    `  BASE=http://127.0.0.1:3100 MODE=auth k6 run frontend/scripts/loadtest.js`,
);
