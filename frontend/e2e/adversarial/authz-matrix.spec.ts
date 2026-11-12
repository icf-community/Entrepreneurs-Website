import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { LEAKY, assertLocal, deleteMember, newMember, psql, service, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Authorization matrix, RPC level.
//
// PostgREST publishes every function a browser role may execute, and the
// anon key is public, so the RPC is the real trust boundary (the server
// actions in front of it are UX). This spec enumerates the callable
// surface FROM THE DATABASE (not from a hand-kept list, so a function
// added next month is covered automatically) and calls every function as
// every role with well-typed garbage arguments. It asserts:
//
//   1. anon can call exactly the three public helpers; everything else is
//      refused at the grant.
//   2. every admin_* function refuses a signed-in non-admin, whatever
//      their status (pending, rejected, approved student).
//   3. nothing answers with raw Postgres / PostgREST text or an internal
//      error (XX000), for any role: a refusal must be a sentence.
//
// Admin is deliberately NOT swept with garbage arguments: several admin
// functions are destructive (admin_delete_graduates, admin_delete_user …)
// and the positive admin paths are covered by the Playwright admin project.
// ════════════════════════════════════════════════════════════════════

const ANON_ALLOWED = new Set(["get_site_banner", "is_admin", "is_approved"]);
// Destroys the caller; covered by the account-deletion specs instead.
const SKIP = new Set(["delete_my_account"]);

type Fn = { name: string; args: { name: string; type: string; enum: string[] | null }[] };

function listCallable(): Fn[] {
  const raw = psql(`
    select coalesce(json_agg(f), '[]') from (
      select p.proname as name,
             coalesce((
               select json_agg(json_build_object(
                        'name', n,
                        'type', format_type(t, null),
                        'enum', (select json_agg(e.enumlabel order by e.enumsortorder)
                                   from pg_enum e where e.enumtypid = t)))
                 from unnest(
                        coalesce(p.proallargtypes, string_to_array(p.proargtypes::text, ' ')::oid[]),
                        coalesce(p.proargnames, array_fill(''::text, array[cardinality(p.proargtypes)])),
                        coalesce(p.proargmodes, array_fill('i'::"char", array[cardinality(p.proargtypes)]))
                      ) as a(t, n, m)
                where a.m in ('i', 'b', 'v')
             ), '[]') as args
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.prokind = 'f'
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         and (has_function_privilege('anon', p.oid, 'execute')
              or has_function_privilege('authenticated', p.oid, 'execute'))
       order by p.proname, p.oid
    ) f`);
  return JSON.parse(raw) as Fn[];
}

const NIL = "00000000-0000-0000-0000-000000000000";

function dummy(type: string, enumLabels: string[] | null): unknown {
  if (enumLabels?.length) return enumLabels[0];
  if (type.endsWith("[]")) return [];
  switch (type) {
    case "uuid": return NIL;
    case "boolean": return false;
    case "smallint":
    case "integer":
    case "bigint":
    case "numeric": return 0;
    case "jsonb":
    case "json": return {};
    case "date": return new Date().toISOString().slice(0, 10);
    case "timestamp with time zone":
    case "timestamp without time zone": return new Date().toISOString();
    default: return "";
  }
}

const anonClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

type Outcome = { fn: string; role: string; code?: string; message?: string; ok: boolean };

async function sweep(role: string, client: SupabaseClient, fns: Fn[]): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const f of fns) {
    if (SKIP.has(f.name)) continue;
    const args = Object.fromEntries(f.args.map((a) => [a.name, dummy(a.type, a.enum)]));
    const { error } = await client.rpc(f.name, args as never);
    out.push({ fn: f.name, role, code: error?.code, message: error?.message, ok: !error });
  }
  return out;
}

test.describe.configure({ mode: "serial" });

let fns: Fn[] = [];
let pending: Member;
let rejected: Member;
let student: Member;
const results: Outcome[] = [];

test.beforeAll(async () => {
  assertLocal();
  fns = listCallable();
  pending = await newMember("authz-pending", { status: "pending_review" });
  rejected = await newMember("authz-rejected");
  await service().from("profiles").update({ status: "rejected" }).eq("id", rejected.id);
  student = await newMember("authz-student");
});

test.afterAll(async () => {
  for (const m of [pending, rejected, student]) if (m) await deleteMember(m);
});

test("the enumeration sees the surface it should (guards the guard)", () => {
  // If this drops sharply the SQL above has stopped matching and every
  // other assertion in this file would pass vacuously.
  expect(fns.length).toBeGreaterThan(120);
  expect(fns.filter((f) => f.name.startsWith("admin_")).length).toBeGreaterThan(30);
});

test("anon can call exactly the public helpers and nothing else", async () => {
  const out = await sweep("anon", anonClient(), fns);
  results.push(...out);
  const allowed = out.filter((o) => o.ok).map((o) => o.fn);
  const stray = allowed.filter((n) => !ANON_ALLOWED.has(n));
  expect(stray, `anon succeeded on: ${stray.join(", ")}`).toEqual([]);
  // Every other function was refused at the grant (42501) or by the gateway,
  // never answered from inside the function body.
  const reachedBody = out.filter(
    (o) => !o.ok && !ANON_ALLOWED.has(o.fn) && o.code !== "42501" && o.code !== "PGRST202" && o.code !== "PGRST301",
  );
  expect(reachedBody.map((o) => `${o.fn}:${o.code}:${o.message}`), "anon reached a function body").toEqual([]);
});

for (const role of ["pending", "rejected", "student"] as const) {
  test(`${role}: every admin_* function refuses, and nothing leaks internals`, async () => {
    const member = { pending, rejected, student }[role];
    const out = await sweep(role, member.client, fns);
    results.push(...out);

    const adminOpen = out.filter((o) => o.fn.startsWith("admin_") && o.ok);
    expect(adminOpen.map((o) => o.fn), `${role} was ALLOWED admin functions`).toEqual([]);

    // 23514 (a table CHECK) is exempt by design: the constraint is the
    // authority, the UI never shows it (zod runs first and describeSupabaseError
    // maps any that slips through), and only a direct API caller sees the
    // constraint name, which is in the repo anyway. Informational finding I-1 in
    // tasks/e2e-adversarial-sweep.md. Every other raw Postgres message still fails.
    const leaks = out.filter((o) => o.message && o.code !== "23514" && (LEAKY.test(o.message) || o.code === "XX000"));
    expect(
      leaks.map((o) => `${o.fn} [${o.code}] ${o.message}`),
      `${role}: responses that expose Postgres internals`,
    ).toEqual([]);
  });
}

test("a pending or rejected member gets nothing from the member-only read RPCs", async () => {
  // is_approved() gates the read surface; a member who has not been admitted
  // must see no directory, listing or community data.
  // Positive control: the same call as an admitted student returns rows, so an
  // empty answer for the others is the gate working, not an empty table.
  // No arguments: dummy values like p_limit=0 would make even the control empty.
  const control = await student.client.rpc("list_directory_cards");
  expect(Array.isArray(control.data) ? control.data.length : 0, `control failed: ${control.error?.message}`).toBeGreaterThan(0);

  const readers = ["list_directory_cards", "list_approved_events", "list_approved_opportunities", "list_approved_vcs_grants", "list_community_feed", "list_committee_cards"];
  for (const m of [pending, rejected]) {
    for (const name of readers) {
      if (!fns.some((x) => x.name === name)) continue;
      const { data, error } = await m.client.rpc(name);
      const rows = Array.isArray(data) ? data.length : data ? 1 : 0;
      expect(rows, `${name} returned data to a non-admitted member (error: ${error?.message})`).toBe(0);
    }
  }
});

test.afterAll(() => {
  const refused = results.filter((r) => !r.ok).length;
  console.log(`authz matrix: ${fns.length} callable functions x 4 roles = ${results.length} calls, ${refused} refused`);
});
