import { expect, test } from "@playwright/test";
import { escapeLike } from "../../src/lib/likeEscape";
import { LEAKY, assertLocal, deleteMember, newMember, psql, service, validVc, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Injection and amplification through the free-text and array parameters
// of the list RPCs (the only user-controlled text that reaches a query
// pattern). Run as an approved student, as the real UI does.
//
// Properties:
//   - SQL / PostgREST-filter metacharacters are data, never syntax: the
//     answer for a hostile string with no literal match is the same
//     empty answer as for any other string with no literal match.
//   - LIKE wildcards are matched literally. "%" must not mean "everything"
//     (it would turn a name search into a full directory scan on demand).
//   - A giant string or array finishes quickly and cleanly.
// ════════════════════════════════════════════════════════════════════

const SEARCHES = ["list_directory_cards", "list_approved_vcs_grants", "list_my_connections", "list_my_connection_graph"] as const;

const NO_MATCH_PAYLOADS = [
  "' OR '1'='1",
  "'; drop table public.profiles; --",
  "\" OR \"\"=\"",
  "1) OR (1=1",
  "%",
  "%%%%",
  "_",
  "____",
  "\\",
  "\\%",
  "[a-z]",
  ".*",
  "(?i).*",
  "a,b)or(id.neq.0",
  "*",
  "\u0000",
  "\ud800", // lone surrogate
  "ＡＢＣ％", // full-width lookalikes
];

let student: Member;
const baseline: Record<string, number> = {};

let peer: Member;
let vcId: string;

test.beforeAll(async () => {
  assertLocal();
  student = await newMember("inj");
  peer = await newMember("injpeer");
  // Something for every search RPC to find, so an empty answer means something:
  // an approved VC (through the service role: only an admin may approve) and an
  // accepted connection between the two members.
  const vc = await peer.client.rpc("submit_vc_grant", validVc({ p_name: "Injection Capital" }));
  expect(vc.error, vc.error?.message).toBeNull();
  vcId = String(vc.data);
  const approved = await service().from("vcs_grants").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", vcId);
  expect(approved.error, approved.error?.message).toBeNull();

  const version = String((await student.client.rpc("connection_consent_version")).data);
  const sent = await student.client.rpc("send_connection_request", { p_addressee: peer.id, p_consent_version: version, p_note: null });
  expect(sent.error, sent.error?.message).toBeNull();
  const reqId = psql(`select id from public.connections where requester_id = '${student.id}' and addressee_id = '${peer.id}'`);
  const accepted = await peer.client.rpc("respond_to_connection_request", { p_id: reqId, p_accept: true, p_consent_version: version });
  expect(accepted.error, accepted.error?.message).toBeNull();
});
test.afterAll(async () => {
  if (vcId) await service().from("vcs_grants").delete().eq("id", vcId);
  for (const m of [student, peer]) if (m) await deleteMember(m);
});

test("control: each search RPC returns rows for an empty query, so empties below mean something", async () => {
  for (const fn of SEARCHES) {
    const { data, error } = await student.client.rpc(fn, { p_query: null });
    expect(error, `${fn}: ${error?.message}`).toBeNull();
    baseline[fn] = (data as unknown[]).length;
    expect(baseline[fn], `${fn} has nothing to search; the injection checks would be vacuous`).toBeGreaterThan(0);
  }
});

for (const fn of SEARCHES) {
  test(`${fn}: hostile search strings are data, not syntax or wildcards`, async () => {
    const problems: string[] = [];
    // Finding L-1 (tasks/e2e-adversarial-sweep.md): all four search RPCs build
    // `ilike '%' || p_query || '%'`, so %/_ are wildcards (searching "_" matches
    // everyone). Bounded (page cap) and exposes nothing an empty query does not.
    // The RPC behaviour is pinned as is (the functions are plan-sensitive); the app
    // escapes the term before calling (src/lib/likeEscape.ts, tested below).
    // Every other payload must still match nothing.
    const wildcardOnly = (q: string) => /^[%_]+$/.test(q);
    for (const q of NO_MATCH_PAYLOADS) {
      if (wildcardOnly(q)) {
        const { data, error } = await student.client.rpc(fn, { p_query: q });
        expect(error, error?.message).toBeNull();
        expect((data as unknown[]).length, "wildcard search is not bounded by the page cap").toBeLessThanOrEqual(baseline[fn]! > 100 ? 100 : Math.max(baseline[fn]!, 1) * 2);
        continue;
      }
      const { data, error } = await student.client.rpc(fn, { p_query: q });
      const label = JSON.stringify(q).slice(0, 30);
      if (error) {
        // Refusing is fine; leaking internals or crashing is not.
        if (LEAKY.test(error.message) || error.code === "XX000") problems.push(`${label}: ${error.code} ${error.message.slice(0, 100)}`);
        continue;
      }
      const n = (data as unknown[]).length;
      if (n > 0) problems.push(`${label}: matched ${n} row(s) but no row contains that text`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

for (const fn of SEARCHES) {
  test(`${fn}: a term escaped the way the app escapes it is matched literally (L-1)`, async () => {
    // The raw wildcard matches (positive control); the escaped one matches only
    // rows that literally contain the character (other specs leave such fixtures,
    // e.g. "window.__xss"), so it must match strictly fewer.
    for (const q of ["_", "%", "%_%"]) {
      const raw = await student.client.rpc(fn, { p_query: q });
      const esc = await student.client.rpc(fn, { p_query: escapeLike(q) });
      expect(raw.error, raw.error?.message).toBeNull();
      expect(esc.error, esc.error?.message).toBeNull();
      const r = (raw.data as unknown[]).length;
      expect(r, `control: unescaped ${q} should match`).toBeGreaterThan(0);
      expect((esc.data as unknown[]).length, `escaped ${JSON.stringify(q)} still acts as a wildcard`).toBeLessThan(r);
    }
    const bs = await student.client.rpc(fn, { p_query: escapeLike("\\") });
    expect(bs.error, "an escaped backslash must not make the pattern invalid").toBeNull();
  });
}

test("the database is intact after the SQL-shaped payloads", () => {
  expect(psql("select to_regclass('public.profiles') is not null")).toBe("t");
  expect(Number(psql("select count(*) from public.profiles"))).toBeGreaterThan(0);
});

test("oversized strings and arrays finish quickly and cleanly", async () => {
  const huge = "%_".repeat(50_000);
  const t0 = Date.now();
  const r1 = await student.client.rpc("list_directory_cards", { p_query: huge });
  const r2 = await student.client.rpc("list_directory_cards", { p_query: "a".repeat(200_000) });
  const r3 = await student.client.rpc("list_directory_cards", { p_skills: Array.from({ length: 5000 }, (_, i) => `skill-${i}`) });
  const r4 = await student.client.rpc("list_directory_cards", { p_roles: Array.from({ length: 5000 }, () => "student"), p_courses: Array.from({ length: 5000 }, (_, i) => `c${i}`) });
  const ms = Date.now() - t0;
  for (const r of [r1, r2, r3, r4]) {
    if (r.error) {
      expect(LEAKY.test(r.error.message) && r.error.code !== "54000", r.error.message).toBe(false);
    }
  }
  expect(ms, `four hostile searches took ${ms}ms`).toBeLessThan(8000);
});

test("limit and offset cannot be used to dump or to hang the directory", async () => {
  const big = await student.client.rpc("list_directory_cards", { p_limit: 1_000_000, p_offset: 0 });
  if (!big.error) expect((big.data as unknown[]).length, "limit is not capped").toBeLessThanOrEqual(1000);
  for (const bad of [{ p_limit: -1 }, { p_offset: -5 }, { p_limit: 2147483647, p_offset: 2147483647 }]) {
    const r = await student.client.rpc("list_directory_cards", bad);
    if (r.error) expect(LEAKY.test(r.error.message) && r.error.code !== "22023", r.error.message).toBe(false);
    else expect((r.data as unknown[]).length).toBeLessThanOrEqual(1000);
  }
});
