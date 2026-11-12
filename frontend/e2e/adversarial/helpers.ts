import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

// ════════════════════════════════════════════════════════════════════
// Adversarial sweep helpers.
//
// Everything here talks to the LOCAL Supabase stack that global-setup has
// already verified is local (it hard-fails on a non-local host). Throwaway
// members are created per test with a unique tag so nothing here can
// collide with the seeded identities other specs depend on.
// ════════════════════════════════════════════════════════════════════

const URL_ = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function assertLocal(): void {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_() ?? "")) {
    throw new Error(`refusing to run adversarial tests against ${URL_()}`);
  }
}

export const service = (): SupabaseClient => {
  assertLocal();
  return createClient(URL_(), SERVICE(), { auth: { persistSession: false, autoRefreshToken: false } });
};

export type Member = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

let counter = 0;
const run = Date.now().toString(36);

/** SQL against the local DB via the supabase container (same path ai.spec.ts uses). */
export function psql(sql: string): string {
  assertLocal();
  return execFileSync(
    "docker",
    ["exec", "supabase_db_EntrepreneursWebsite", "psql", "-U", "postgres", "-At", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

export async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(URL_(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

/**
 * A fresh approved member with completed intake (so they can send
 * connection requests) and a password session.
 */
export async function newMember(
  tag: string,
  opts: { admin?: boolean; intake?: boolean; status?: "approved" | "pending_review" } = {},
): Promise<Member> {
  const db = service();
  counter += 1;
  const email = `adv-${tag}-${run}-${counter}@imperial.ac.uk`.toLowerCase();
  const password = "Adv-Sweep-Pw-123!";
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "Adv", surname: `${tag}${counter}`, role: "student" },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const id = data.user!.id;
  const { error: pErr } = await db
    .from("profiles")
    .update({
      status: opts.status ?? "approved",
      course: "MEng Computing",
      grad_year: 2027,
      ...(opts.intake === false
        ? { intake_deferred_at: new Date().toISOString() }
        : { profile_version: 2, intake_deferred_at: null }),
    })
    .eq("id", id);
  if (pErr) throw new Error(`profile ${email}: ${pErr.message}`);
  await db.from("member_education").upsert(
    { member_id: id, currently_enrolled: true, has_completed_degree: false },
    { onConflict: "member_id" },
  );
  if (opts.admin) await db.from("admins").upsert({ user_id: id }, { onConflict: "user_id" });
  return { id, email, password, client: await signedIn(email, password) };
}

export async function deleteMember(m: Member): Promise<void> {
  try {
    await service().auth.admin.deleteUser(m.id);
  } catch {
    /* best effort — local stack, wiped by db reset */
  }
}

export const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

/** Fire `n` copies of `fn` in the same tick; never throws, returns every outcome. */
export async function burst<T>(n: number, fn: (i: number) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
}

export type RpcOutcome = { data: unknown; error: { code?: string; message: string } | null };

export const rpc = async (c: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<RpcOutcome> => {
  const { data, error } = await c.rpc(fn, args as never);
  return { data, error: error ? { code: error.code, message: error.message } : null };
};

/**
 * Messages that must never reach a member: raw Postgres / PostgREST /
 * internal-function text. A refusal should be a sentence a person can
 * read, not an implementation detail.
 */
export const LEAKY = /violates|constraint|duplicate key|syntax error|invalid input syntax|deadlock|could not serialize|relation "|column "|function public\.|null value in column|permission denied for|stack depth|out of range|value too long|PGRST|pg_|plpgsql|SQLSTATE/i;

export function validOpportunity(over: Record<string, unknown> = {}) {
  const next = new Date();
  return {
    p_position_name: "Adversarial Engineer",
    p_company: "Sweep Ltd",
    p_pay: "£15/hr",
    p_location_type: "remote",
    p_location_text: null,
    p_description: "A perfectly ordinary description of a perfectly ordinary role.",
    p_start_month: ((next.getMonth() + 2) % 12) + 1,
    p_start_year: next.getFullYear() + 1,
    p_application_deadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    p_contact_email: "hiring@example.com",
    p_contact_email_visible: false,
    p_apply_method: "link",
    p_apply_url: "https://example.com/apply",
    p_skill_ids: [],
    p_sector_ids: [],
    p_eligible_audience: "both",
    ...over,
  };
}

export function validEvent(over: Record<string, unknown> = {}) {
  return {
    p_title: "Adversarial Meetup",
    p_description: "An ordinary event description.",
    p_luma_link: "https://lu.ma/adv-sweep",
    p_event_at: new Date(Date.now() + 14 * 864e5).toISOString(),
    p_location: "Imperial College, SW7",
    p_organiser_name: "Sweep Society",
    p_contact_email: "events@example.com",
    p_contact_email_visible: false,
    ...over,
  };
}

export function validVc(over: Record<string, unknown> = {}) {
  return {
    p_kind: "vc",
    p_name: "Sweep Capital",
    p_description: "An ordinary fund description.",
    p_link: "https://example.com/fund",
    p_amount: "£50k",
    p_deadline: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10),
    p_stage: "pre-seed",
    ...over,
  };
}

import { createServerClient } from "@supabase/ssr";

/**
 * A Playwright storageState for a throwaway member, minted by handing the
 * @supabase/ssr library a capturing cookie jar (same approach as
 * global-setup — never hand-roll the cookie name/chunking).
 */
export async function storageStateFor(m: Member, hostname = "127.0.0.1") {
  const c = (await import("@supabase/supabase-js")).createClient(URL_(), ANON(), { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: m.email, password: m.password });
  if (error || !data.session) throw new Error(`storageState sign-in: ${error?.message}`);
  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient(URL_(), ANON(), {
    cookies: {
      getAll: () => jar,
      setAll: (set) => { for (const { name, value } of set) { const i = jar.findIndex((j) => j.name === name); if (i >= 0) jar[i]!.value = value; else jar.push({ name, value }); } },
    },
  });
  await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  const expires = Math.floor(Date.now() / 1000) + 86400;
  return {
    cookies: jar.map((j) => ({ ...j, domain: hostname, path: "/", expires, httpOnly: false, secure: false, sameSite: "Lax" as const })),
    origins: [] as { origin: string; localStorage: { name: string; value: string }[] }[],
  };
}
