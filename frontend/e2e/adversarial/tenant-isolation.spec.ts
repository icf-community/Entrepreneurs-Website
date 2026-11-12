import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { assertLocal, deleteMember, newMember, psql, service, validEvent, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Tenant isolation (IDOR) against the local stack.
//
// 1. Table surface: a signed-in member and an anonymous caller read every
//    table through the PostgREST table API. The app is RPC-only, so the
//    only rows either may see are the public catalogues (and their own).
// 2. Cross-member writes: member B uses member A's valid ids against the
//    id-addressed RPCs (listing edit, post delete, connection lifecycle,
//    notifications). Each must be refused AND leave A's data untouched,
//    which is verified with the service role, not with B's reply.
// ════════════════════════════════════════════════════════════════════

const OWNER_COLS = ["member_id", "user_id", "profile_id", "created_by", "author_id", "sender_id", "reporter_id", "requester_id"];
// Tables a browser role is meant to read directly.
const PUBLIC_CATALOGUES = new Set(["skills", "sectors"]);
// Readable by any approved member by design (the community feed).
const MEMBER_SHARED = new Set(["posts", "post_images"]);
// Readable by an approved member only once approved, or when they posted it.
const LISTINGS = new Set(["events", "opportunities", "vcs_grants"]);

const anon = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

let a: Member;
let b: Member;
let c: Member;

test.beforeAll(async () => {
  assertLocal();
  a = await newMember("iso-a");
  b = await newMember("iso-b");
  c = await newMember("iso-c");
});

test.afterAll(async () => {
  for (const m of [a, b, c]) if (m) await deleteMember(m);
});

test("table API: a member and an anonymous caller read nothing but the catalogues", async () => {
  const tables = psql(
    `select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1`,
  ).split("\n");
  expect(tables.length).toBeGreaterThan(30); // guards the guard

  const exposed: string[] = [];
  for (const [label, client] of [["member", b.client], ["anon", anon()]] as const) {
    for (const t of tables) {
      if (PUBLIC_CATALOGUES.has(t)) continue;
      const { data, error } = await client.from(t).select("*").limit(1000);
      if (error || !data?.length) continue; // refused at the grant, or RLS filtered to nothing
      // Rows are only acceptable if the table is shared by design for this
      // role, or they all belong to the caller.
      const rows = data as Record<string, unknown>[];
      const mine = label === "member" && (
        MEMBER_SHARED.has(t) ||
        (LISTINGS.has(t) && rows.every((r) => r.status === "approved" || r.posted_by === b.id)) ||
        rows.every((r) => OWNER_COLS.some((col) => r[col] === b.id))
      );
      if (!mine) exposed.push(`${label} reads ${data.length} row(s) of ${t}`);
    }
  }
  expect(exposed, "tables readable outside the RPC surface").toEqual([]);

  // Control: the catalogues really are readable, so "nothing" above is a
  // property of the tables, not of a broken client.
  const { data: skills } = await b.client.from("skills").select("id").limit(1);
  expect(skills?.length).toBe(1);
});

test("a member cannot edit, read for edit, or withdraw another member's listing", async () => {
  const sub = await a.client.rpc("submit_event", validEvent());
  expect(sub.error, sub.error?.message).toBeNull();
  const id = String(sub.data);
  const before = psql(`select title || '|' || edit_version || '|' || status from public.events where id = '${id}'`);

  const upd = await b.client.rpc("update_event", {
    p_id: id,
    p_title: "Hijacked by B",
    p_description: "B rewrote A's event description entirely.",
    p_luma_link: "https://example.com/b",
    p_event_at: new Date(Date.now() + 10 * 864e5).toISOString(),
    p_location: "B's place",
    p_organiser_name: "B",
    p_contact_email: "b@example.com",
    p_contact_email_visible: true,
    p_expected_version: null,
  });
  expect(upd.error, "B was allowed to update A's event").not.toBeNull();

  const forEdit = await b.client.rpc("get_event_for_edit", { p_id: id });
  expect(forEdit.data == null || (Array.isArray(forEdit.data) && forEdit.data.length === 0), "B read A's event for edit").toBe(true);

  const edit = await b.client.rpc("get_my_listing_edit", { p_kind: "event", p_id: id });
  expect(edit.data == null || (Array.isArray(edit.data) && edit.data.length === 0), "B read A's listing edit").toBe(true);

  expect(psql(`select title || '|' || edit_version || '|' || status from public.events where id = '${id}'`)).toBe(before);

  // Control: the owner can edit it, so the refusals above are about B.
  const own = await a.client.rpc("get_event_for_edit", { p_id: id });
  expect(own.error, own.error?.message).toBeNull();
  expect(own.data).toBeTruthy();
});

test("a member cannot delete another member's post, but the owner can", async () => {
  const made = await a.client.rpc("create_post", { p_title: "Isolation post", p_body: "Written by A for the isolation test." });
  expect(made.error, made.error?.message).toBeNull();
  const id = psql(`select id from public.posts where author_id = '${a.id}' order by created_at desc limit 1`);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  const del = await b.client.rpc("delete_my_post", { p_post_id: id });
  expect(del.error, "B deleted A's post").not.toBeNull();
  expect(psql(`select count(*) from public.posts where id = '${id}'`)).toBe("1");

  const own = await a.client.rpc("delete_my_post", { p_post_id: id });
  expect(own.error, own.error?.message).toBeNull();
  expect(psql(`select count(*) from public.posts where id = '${id}'`), "the owner's delete did not delete").toBe("0");
});

test("a third party cannot answer, withdraw or remove someone else's connection, or mark their notifications read", async () => {
  const version = String((await a.client.rpc("connection_consent_version")).data);
  const sent = await a.client.rpc("send_connection_request", { p_addressee: c.id, p_consent_version: version, p_note: null });
  expect(sent.error, sent.error?.message).toBeNull();
  const reqId = psql(`select id from public.connections where requester_id = '${a.id}' and addressee_id = '${c.id}' order by created_at desc limit 1`);
  expect(reqId).toMatch(/^[0-9a-f-]{36}$/);
  const state = () => psql(`select status from public.connections where id = '${reqId}'`);
  expect(state()).toBe("pending");

  const answer = await b.client.rpc("respond_to_connection_request", { p_id: reqId, p_accept: true, p_consent_version: version });
  expect(answer.error, "B accepted a request addressed to C").not.toBeNull();
  const withdraw = await b.client.rpc("withdraw_connection_request", { p_id: reqId });
  expect(withdraw.error, "B withdrew A's request").not.toBeNull();
  const remove = await b.client.rpc("remove_connection", { p_id: reqId });
  expect(remove.error, "B removed a connection it is not part of").not.toBeNull();
  expect(state(), "the request changed state").toBe("pending");

  // C's notification for A's request: B must not be able to mark it read.
  const notif = psql(`select id from public.notifications where user_id = '${c.id}' and read_at is null order by created_at desc limit 1`);
  expect(notif, "the request raised no notification for C, so the check below would be vacuous").toMatch(/^[0-9a-f-]{36}$/);
  await b.client.rpc("mark_notifications_read", { p_ids: [notif] });
  expect(psql(`select read_at is null from public.notifications where id = '${notif}'`), "B marked C's notification read").toBe("t");

  // Control: the addressee can answer.
  const ok = await c.client.rpc("respond_to_connection_request", { p_id: reqId, p_accept: false, p_consent_version: version });
  expect(ok.error, ok.error?.message).toBeNull();
});

test("the service-role key is not what a member client carries (sanity for the harness itself)", async () => {
  const token = (await b.client.auth.getSession()).data.session!.access_token;
  const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
  expect(claims.role).toBe("authenticated");
  expect(service()).toBeTruthy();
});
