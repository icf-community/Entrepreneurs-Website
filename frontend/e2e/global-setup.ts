import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { mkdirSync, writeFileSync, statSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { USERS, storageStatePath, type SeedUser } from "./fixtures";

// ════════════════════════════════════════════════════════════════════
// E2E global setup — runs once against the ephemeral Supabase before any
// spec. Seeds an approved student + an admin via the admin API (real
// passwords, since CI owns the local GoTrue), then mints each one's
// session into a Playwright storageState so the authed projects start
// logged in. No magic link needed.
// ════════════════════════════════════════════════════════════════════

export default async function globalSetup(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey) {
    throw new Error(
      "E2E global-setup: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
        "SUPABASE_SERVICE_ROLE_KEY must be set (CI exports these from `supabase status`).",
    );
  }

  assertEphemeral(url);
  assertFreshBuild();
  assertBuildMatchesBackend(url);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const hostname = new URL(url).hostname;

  for (const user of Object.values(USERS)) {
    await seedUser(admin, user);
    const session = await passwordSession(url, anon, user);
    const storageState = await sessionToStorageState(url, anon, session, hostname);
    const path = storageStatePath(user.role);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(storageState, null, 2));
  }
}


/**
 * Refuses to run a build that was compiled against a DIFFERENT Supabase.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so `next build` with the
 * wrong environment produces a bundle that talks to the wrong backend for
 * the rest of its life — and `next start` cannot tell. The suite then
 * seeds the ephemeral stack, mints a session against it, and drives an app
 * pointed somewhere else entirely. Every authed page bounces to /login and
 * every failure is a lie.
 *
 * `next build` reads .env.local on its own, and in this repo .env.local
 * holds the PRODUCTION url. So the wrong build is what you get by running
 * `pnpm build` in a shell that has not exported `supabase status -o env` —
 * which is the obvious thing to do and gives no sign of being wrong.
 *
 * Checked against the client chunks rather than a variable, because the
 * inlined string is the thing that actually determines where the browser
 * talks. If the host under test is not in there, something else is.
 */
function assertBuildMatchesBackend(url: string): void {
  const host = new URL(url).host;
  const dir = ".next/static/chunks";

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  } catch {
    return; // No client chunks to check; assertFreshBuild covers a missing build.
  }

  const foreign = new Set<string>();
  for (const f of files) {
    const source = readFileSync(join(dir, f), "utf8");
    if (source.includes(host)) return; // The build points at the stack under test.
    for (const m of source.matchAll(/https:\/\/[a-z0-9]+\.supabase\.co/g)) foreign.add(m[0]);
  }

  throw new Error(
    `E2E: the build in .next was compiled against ${[...foreign].join(", ") || "an unknown Supabase"}, ` +
      `not ${url}. NEXT_PUBLIC_* is inlined at build time and .env.local holds the PRODUCTION url, ` +
      "so `pnpm build` without the ephemeral env baked in the wrong backend. Re-run it with " +
      "`supabase status -o env` exported, then start the suite again.",
  );
}

/**
 * Refuses to run against a build older than the source it is meant to test.
 *
 * `pnpm start` is plain `next start`: it serves whatever .next already
 * holds and never rebuilds. So editing a component and running the suite
 * tests the PREVIOUS build, silently, and the run is green for the wrong
 * reason — or red for a bug that was fixed hours ago.
 *
 * That happened. A five-hour-old build served every local run of a
 * session, including a before/after comparison that was supposed to prove
 * a refactor changed no behaviour: both halves ran the same stale code, so
 * it proved nothing. CI was unaffected — it builds first — which is
 * precisely why nothing caught it.
 *
 * The check is a timestamp comparison, not a hash: it only has to notice
 * that source is newer than the build, and it must never be the reason a
 * suite fails to start, so a missing .next says "run pnpm build" rather
 * than throwing something cryptic.
 */
function assertFreshBuild(): void {
  const buildId = ".next/BUILD_ID";
  let builtAt: number;
  try {
    builtAt = statSync(buildId).mtimeMs;
  } catch {
    throw new Error("E2E: no .next build found. Run `pnpm build` before `pnpm exec playwright test`.");
  }

  let newest = 0;
  let newestFile = "";
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        const m = statSync(full).mtimeMs;
        if (m > newest) {
          newest = m;
          newestFile = full;
        }
      }
    }
  };
  walk("src");

  if (newest > builtAt) {
    const mins = Math.round((newest - builtAt) / 60_000);
    throw new Error(
      `E2E: .next is ${mins} minute(s) older than ${newestFile}. ` +
        "`next start` serves the last build and never rebuilds, so this run would test stale code. " +
        "Run `pnpm build` first.",
    );
  }
}

/**
 * Refuses to run against anything but a local Supabase.
 *
 * This setup creates users, approves them and grants one of them admin.
 * Against the ephemeral CI stack that is the point; against a hosted
 * project it silently plants three accounts in a real member directory,
 * one of them an administrator. Nothing downstream would notice — the
 * suite passes either way, which is exactly why the check has to be here
 * rather than in a reviewer's memory.
 *
 * It has happened. `.env.local` holds the *production* URL, and exporting
 * those vars to run the suite locally is a one-line mistake that looks
 * identical to the correct one at the shell.
 *
 * Allow-list, not a deny-list: a new hosted environment must fail this,
 * not sneak past a pattern that didn't anticipate it. CI exports
 * `supabase status` output, which is always 127.0.0.1.
 */
function assertEphemeral(url: string): void {
  const host = new URL(url).hostname;
  const local =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "host.docker.internal" ||
    host.endsWith(".local");
  if (local) return;

  throw new Error(
    `E2E refuses to run against ${host}. This setup seeds users and grants admin, ` +
      "so it may only ever point at a local/ephemeral Supabase — never a hosted project. " +
      "Export NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / " +
      "SUPABASE_SERVICE_ROLE_KEY from `supabase status`, not from .env.local.",
  );
}

// Create the auth user (the new-user trigger inserts a pending_onboarding
// profile), then approve it as service_role (bypasses the protect-status
// trigger, exactly like the production service client). Admins also get an
// `admins` row.
async function seedUser(admin: SupabaseClient, user: SeedUser): Promise<string> {
  let userId: string;
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { first_name: user.firstName, surname: user.surname, role: "student" },
  });
  if (error) {
    const existing = await findUserId(admin, user.email);
    if (!existing) throw new Error(`createUser ${user.email}: ${error.message}`);
    userId = existing;
  } else {
    userId = data.user!.id;
  }

  const { error: pErr } = await admin
    .from("profiles")
    // intake_deferred_at mirrors the 20260901000004 backfill for members
    // approved before /intake existed: without it, every seeded user is
    // profile_version 1 with no deferral on record, and requireApprovedUser's
    // bounceToIntake would redirect every `page.goto("/home")` in the suite
    // straight to /intake instead. Specs that actually want to exercise
    // /intake clear this column back to null for their own seeded user.
    .update({
      status: "approved",
      course: "MEng Computing",
      grad_year: 2027,
      // profile_version 2 is "intake complete", which send_connection_request
      // requires. Version 1 + intake_deferred_at is the default here because
      // that is what the rest of the suite asserts against; only the
      // connections pair opts in.
      ...(user.intakeComplete
        ? { profile_version: 2, intake_deferred_at: null }
        : { intake_deferred_at: new Date().toISOString() }),
    })
    .eq("id", userId);
  if (pErr) throw new Error(`approve profile ${user.email}: ${pErr.message}`);

  if (user.isAdmin) {
    const { error: aErr } = await admin
      .from("admins")
      .upsert({ user_id: userId }, { onConflict: "user_id" });
    if (aErr) throw new Error(`grant admin ${user.email}: ${aErr.message}`);
  }
  return userId;
}

async function findUserId(admin: SupabaseClient, email: string): Promise<string | undefined> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
}

async function passwordSession(url: string, anon: string, user: SeedUser): Promise<Session> {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) {
    throw new Error(`sign-in ${user.email}: ${error?.message ?? "no session"}`);
  }
  return data.session;
}

// Turn a session into the exact @supabase/ssr cookie(s) by letting the
// library write them into a capturing jar — version- and project-ref-proof,
// no hand-rolling of the sb-<ref>-auth-token format.
async function sessionToStorageState(
  url: string,
  anon: string,
  session: Session,
  hostname: string,
) {
  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient(url, anon, {
    cookies: {
      getAll: () => jar.map((c) => ({ name: c.name, value: c.value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          const i = jar.findIndex((c) => c.name === name);
          if (i >= 0) jar[i]!.value = value;
          else jar.push({ name, value });
        }
      },
    },
  });
  await ssr.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  return {
    cookies: jar.map((c) => ({
      name: c.name,
      value: c.value,
      domain: hostname,
      path: "/",
      expires,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
    origins: [] as { origin: string; localStorage: { name: string; value: string }[] }[],
  };
}
