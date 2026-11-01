import { test, expect } from "@playwright/test";
import {
  newMember, deleteMember, burst, rpc, service, psql, LEAKY,
  validOpportunity, validEvent, validVc, type Member,
} from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Adversarial · concurrency at the RPC boundary
//
// These fire real parallel calls as real authenticated sessions. Each test
// asserts the property that must hold no matter how the interleaving falls:
// one winner, a consistent final state, and no raw database text in any
// refusal. A failing test here IS a finding.
// ════════════════════════════════════════════════════════════════════

test.describe.configure({ mode: "serial" });

const members: Member[] = [];
const make = async (tag: string, opts?: Parameters<typeof newMember>[1]) => {
  const m = await newMember(tag, opts);
  members.push(m);
  return m;
};
test.afterAll(async () => { await Promise.all(members.map(deleteMember)); });

async function consent(m: Member): Promise<string> {
  const { data } = await m.client.rpc("connection_consent_version");
  return data as string;
}
const rows = (a: string, b: string) =>
  psql(`select status||'/'||coalesce(blocked_by::text,'-') from connections where (requester_id='${a}' and addressee_id='${b}') or (requester_id='${b}' and addressee_id='${a}') order by created_at`)
    .split("\n").filter(Boolean);

test.describe("connections", () => {
  test("30 identical sends A→B create exactly one request and none error", async () => {
    const [a, b] = [await make("dupA"), await make("dupB")];
    const v = await consent(a);
    const out = await burst(30, () => rpc(a.client, "send_connection_request", { p_addressee: b.id, p_consent_version: v }));
    const results = out.map((o) => (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value);
    const errs = results.filter((r) => r.error);
    expect(errs.map((e) => e.error!.message), "idempotent send must not error").toEqual([]);
    expect(rows(a.id, b.id)).toHaveLength(1);
    expect(new Set(results.map((r) => r.data)).size, "all sends return the same id").toBe(1);
  });

  test("crossed requests A→B and B→A at the same instant leave one live row, no raw errors", async () => {
    for (let round = 0; round < 5; round += 1) {
      const [a, b] = [await make(`crossA${round}`), await make(`crossB${round}`)];
      const v = await consent(a);
      const [r1, r2] = await Promise.all([
        rpc(a.client, "send_connection_request", { p_addressee: b.id, p_consent_version: v }),
        rpc(b.client, "send_connection_request", { p_addressee: a.id, p_consent_version: v }),
      ]);
      for (const r of [r1, r2]) if (r.error) expect(r.error.message, `round ${round}`).not.toMatch(LEAKY);
      const live = rows(a.id, b.id);
      expect(live.length, `round ${round}: rows ${live.join(",")} errs ${r1.error?.message}|${r2.error?.message}`).toBeLessThanOrEqual(1);
      expect(live.length, "someone's request must have landed").toBeGreaterThanOrEqual(1);
    }
  });

  test("daily send cap holds under a parallel burst (cap 10, 16 recipients)", async () => {
    const sender = await make("capSender");
    const targets = await Promise.all(Array.from({ length: 16 }, (_, i) => make(`capT${i}`)));
    const v = await consent(sender);
    const out = await burst(16, (i) => rpc(sender.client, "send_connection_request", { p_addressee: targets[i]!.id, p_consent_version: v }));
    const results = out.map((o) => (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value);
    const okCount = results.filter((r) => !r.error).length;
    const stored = Number(psql(`select count(*) from connections where requester_id='${sender.id}'`));
    expect(stored, "rows actually stored").toBeLessThanOrEqual(10);
    expect(okCount).toBeLessThanOrEqual(10);
    for (const r of results) if (r.error) expect(r.error.message).not.toMatch(LEAKY);
  });

  test("accept ×2 in parallel: exactly one disclosure, the other is told it's no longer pending", async () => {
    const [a, b] = [await make("accA"), await make("accB")];
    const v = await consent(a);
    const { data: id } = await a.client.rpc("send_connection_request", { p_addressee: b.id, p_consent_version: v });
    const out = await burst(8, () => rpc(b.client, "respond_to_connection_request", { p_id: id as string, p_accept: true, p_consent_version: v }));
    const results = out.map((o) => (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value);
    const withRow = results.filter((r) => !r.error && (Array.isArray(r.data) ? r.data.length : r.data));
    expect(withRow, "only one racer may receive the requester's identity (and trigger the email)").toHaveLength(1);
    for (const r of results) if (r.error) expect(r.error.message).not.toMatch(LEAKY);
    expect(rows(a.id, b.id)).toEqual(["accepted/-"]);
  });

  test("accept racing withdraw ends in exactly one coherent state", async () => {
    for (let round = 0; round < 6; round += 1) {
      const [a, b] = [await make(`rwA${round}`), await make(`rwB${round}`)];
      const v = await consent(a);
      const { data: id } = await a.client.rpc("send_connection_request", { p_addressee: b.id, p_consent_version: v });
      const [acc, wd] = await Promise.all([
        rpc(b.client, "respond_to_connection_request", { p_id: id as string, p_accept: true, p_consent_version: v }),
        rpc(a.client, "withdraw_connection_request", { p_id: id as string }),
      ]);
      for (const r of [acc, wd]) if (r.error) expect(r.error.message).not.toMatch(LEAKY);
      const st = rows(a.id, b.id);
      expect(st, `round ${round}`).toHaveLength(1);
      // The dangerous outcome: B was shown A's identity (accept returned a row)
      // but the stored state says withdrawn — a disclosure with no connection.
      const accGotRow = !acc.error && (Array.isArray(acc.data) ? acc.data.length : !!acc.data);
      if (accGotRow) expect(st[0], `round ${round}: accept disclosed but state is ${st[0]}`).toBe("accepted/-");
    }
  });

  test("remove ×2 and remove-vs-accept do not double-apply cooldown or error raw", async () => {
    const [a, b] = [await make("rmA"), await make("rmB")];
    const v = await consent(a);
    const { data: id } = await a.client.rpc("send_connection_request", { p_addressee: b.id, p_consent_version: v });
    await b.client.rpc("respond_to_connection_request", { p_id: id as string, p_accept: true, p_consent_version: v });
    const out = await burst(6, (i) => rpc(i % 2 ? a.client : b.client, "remove_connection", { p_id: id as string }));
    for (const o of out) {
      const r = (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value;
      if (r.error) expect(r.error.message).not.toMatch(LEAKY);
    }
    expect(rows(a.id, b.id)).toHaveLength(1);
  });

  test("block racing a send: after block_member returns, no pending request reaches the blocker", async () => {
    for (let round = 0; round < 6; round += 1) {
      const [a, b] = [await make(`blA${round}`), await make(`blB${round}`)];
      const v = await consent(a);
      await Promise.all([
        rpc(a.client, "send_connection_request", { p_addressee: b.id, p_consent_version: v }),
        rpc(b.client, "block_member", { p_member: a.id }),
      ]);
      // Whatever order they ran in, a blocked sender must not be left with a
      // live pending request sitting in the blocker's inbox.
      const pending = psql(`select count(*) from connections where requester_id='${a.id}' and addressee_id='${b.id}' and status='pending'`);
      expect(Number(pending), `round ${round}: pending request survived a block`).toBe(0);
    }
  });

  test("send racing the sender deleting their own account does not wedge or leak", async () => {
    // I-1b (fixed in 20261026000011): a send that loses to the sender's own
    // delete_my_account used to return `connections_requester_id_fkey` (23503).
    // Whichever side wins, no foreign-key text may reach the caller and no
    // connection row may survive. Several rounds, since who wins is timing.
    const FK = /fkey|foreign key|23503|violates/i;
    for (let round = 0; round < 6; round += 1) {
      const [a, b] = [await make(`delA${round}`), await make(`delB${round}`)];
      const v = await consent(a);
      const [s, d] = await Promise.all([
        rpc(a.client, "send_connection_request", { p_addressee: b.id, p_consent_version: v }),
        rpc(a.client, "delete_my_account"),
      ]);
      for (const r of [s, d]) if (r.error) {
        expect(r.error.message, `round ${round}`).not.toMatch(LEAKY);
        expect(r.error.message, `round ${round}`).not.toMatch(FK);
      }
      const orphan = psql(`select count(*) from connections where requester_id='${a.id}' or addressee_id='${a.id}'`);
      expect(Number(orphan), `round ${round}: connection rows survive their member's deletion`).toBe(0);
    }
  });

  test("send racing the ADDRESSEE deleting their account does not reveal that it is gone", async () => {
    const FK = /fkey|foreign key|23503|violates/i;
    for (let round = 0; round < 6; round += 1) {
      const [a, b] = [await make(`adA${round}`), await make(`adB${round}`)];
      const v = await consent(a);
      const [s, d] = await Promise.all([
        rpc(a.client, "send_connection_request", { p_addressee: b.id, p_consent_version: v }),
        rpc(b.client, "delete_my_account"),
      ]);
      for (const [who, r] of [["send", s], ["delete_my_account", d]] as const) if (r.error) {
        expect(r.error.message, `round ${round}, ${who} (${r.error.code})`).not.toMatch(LEAKY);
        expect(r.error.message, `round ${round}, ${who} (${r.error.code})`).not.toMatch(FK);
      }
      const orphan = psql(`select count(*) from connections where requester_id='${b.id}' or addressee_id='${b.id}'`);
      expect(Number(orphan), `round ${round}: connection rows survive their member's deletion`).toBe(0);
    }
  });

  test("other writes that reference a member never deadlock with that member deleting their account", async () => {
    // Same shape as the send race (20261026000012): any write holding a lock on
    // another member's profile can meet that member's delete_my_account.
    const FK = /fkey|foreign key|23503|violates|deadlock/i;
    for (let round = 0; round < 5; round += 1) {
      // block_member(target) while the target deletes themselves.
      const [blocker, target] = [await make(`rbBl${round}`), await make(`rbTg${round}`)];
      const [r1, r2] = await Promise.all([
        rpc(blocker.client, "block_member", { p_member: target.id }),
        rpc(target.client, "delete_my_account"),
      ]);
      for (const [who, r] of [["block_member", r1], ["delete_my_account", r2]] as const) if (r.error) {
        expect(r.error.message, `block round ${round}, ${who} (${r.error.code})`).not.toMatch(LEAKY);
        expect(r.error.message, `block round ${round}, ${who} (${r.error.code})`).not.toMatch(FK);
      }
      expect(Number(psql(`select count(*) from connections where requester_id='${target.id}' or addressee_id='${target.id}'`)), `block round ${round}: orphan rows`).toBe(0);

      // respond_to_connection_request while the requester deletes themselves.
      const [req, resp] = [await make(`rrQ${round}`), await make(`rrR${round}`)];
      const send = await rpc(req.client, "send_connection_request", { p_addressee: resp.id, p_consent_version: await consent(req) });
      expect(send.error, send.error?.message).toBeNull();
      const id = psql(`select id from connections where requester_id='${req.id}' and addressee_id='${resp.id}'`);
      const [r3, r4] = await Promise.all([
        rpc(resp.client, "respond_to_connection_request", { p_id: id, p_accept: true, p_consent_version: await consent(resp) }),
        rpc(req.client, "delete_my_account"),
      ]);
      for (const [who, r] of [["respond", r3], ["delete_my_account", r4]] as const) if (r.error) {
        expect(r.error.message, `respond round ${round}, ${who} (${r.error.code})`).not.toMatch(LEAKY);
        expect(r.error.message, `respond round ${round}, ${who} (${r.error.code})`).not.toMatch(FK);
      }
      expect(Number(psql(`select count(*) from connections where requester_id='${req.id}' or addressee_id='${req.id}'`)), `respond round ${round}: orphan rows`).toBe(0);
    }
  });

  test("a foreign-key failure on the write gets the generic refusal, and leaves no row (I-1b, deterministic)", async () => {
    // Forces the lost race: a trigger that fails the insert with the exact
    // foreign-key error, scoped by WHEN to this one sender so parallel specs
    // are untouched. The handler in send_connection_request must turn it into
    // the same refusal as every other "no".
    const [a, b] = [await make("fkSend"), await make("fkRecv")];
    const v = await consent(a);
    psql(`create or replace function public._adv_fk_fail() returns trigger language plpgsql as $$ begin
            raise exception 'insert or update on table "connections" violates foreign key constraint "connections_requester_id_fkey"' using errcode = '23503';
          end $$`);
    psql(`create trigger _adv_fk_fail before insert on public.connections for each row
            when (new.requester_id = '${a.id}') execute function public._adv_fk_fail()`);
    try {
      const r = await rpc(a.client, "send_connection_request", { p_addressee: b.id, p_consent_version: v });
      expect(r.error, "the send should be refused").not.toBeNull();
      expect(r.error!.message).not.toMatch(/fkey|foreign key|23503|violates/i);
      expect(r.error!.code, r.error!.message).toBe("42501");
      expect(Number(psql(`select count(*) from connections where requester_id='${a.id}'`))).toBe(0);
    } finally {
      psql(`drop trigger if exists _adv_fk_fail on public.connections; drop function if exists public._adv_fk_fail()`);
    }
  });
});

test.describe("listings", () => {
  test("20 identical parallel submit_opportunity calls store one listing and all return its id (D-1)", async () => {
    const m = await make("subdup");
    const out = await burst(20, () => rpc(m.client, "submit_opportunity", validOpportunity()));
    const results = out.map((o) => (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value);
    for (const r of results) expect(r.error, r.error?.message).toBeNull();
    expect(Number(psql(`select count(*) from opportunities where posted_by='${m.id}'`)), "identical retries must not duplicate").toBe(1);
    expect(new Set(results.map((r) => r.data)).size, "every retry returns the one listing").toBe(1);
  });

  test("20 DIFFERENT parallel submit_opportunity calls: the review-queue cap holds and refusals read cleanly", async () => {
    const m = await make("subcap");
    const out = await burst(20, (i) => rpc(m.client, "submit_opportunity", validOpportunity({ p_position_name: `Adversarial Engineer ${i}` })));
    const results = out.map((o) => (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value);
    for (const r of results) if (r.error) expect(r.error.message).not.toMatch(LEAKY);
    const stored = Number(psql(`select count(*) from opportunities where posted_by='${m.id}'`));
    // F6: a member can't flood the review queue. The cap is 10 pending per
    // member per kind, enforced in the database so it holds with Upstash off.
    expect(stored, "parallel submits must not slip past the pending cap").toBe(10);
    const refused = results.filter((r) => r.error);
    expect(refused.length).toBe(10);
    for (const r of refused) expect(r.error!.code).toBe("22023");
  });

  test("approve ×2 concurrently with the same expected_version: one approves, no double event/email", async () => {
    const poster = await make("apPoster");
    const admin = await make("apAdmin", { admin: true });
    const { data: id, error } = await poster.client.rpc("submit_opportunity", validOpportunity());
    expect(error).toBeNull();
    const ver = Number(psql(`select edit_version from opportunities where id='${id}'`));
    const out = await burst(6, () => rpc(admin.client, "approve_opportunity", { p_opportunity_id: id as string, p_notes: null, p_expected_version: ver }));
    for (const o of out) {
      const r = (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value;
      if (r.error) expect(r.error.message).not.toMatch(LEAKY);
    }
    const mail = Number(psql(`select count(*) from outbound_email where to_address='${poster.email}'`));
    test.info().annotations.push({ type: "observation", description: `emails to poster after 6 parallel approves: ${mail}` });
    expect(mail, "poster told 'approved' more than once").toBeLessThanOrEqual(1);
  });

  test("approve racing reject on the same listing: single final status, never both a reason and approved_at", async () => {
    for (let round = 0; round < 5; round += 1) {
      const poster = await make(`arP${round}`);
      const admin = await make(`arA${round}`, { admin: true });
      const { data: id } = await poster.client.rpc("submit_opportunity", validOpportunity());
      const ver = Number(psql(`select edit_version from opportunities where id='${id}'`));
      await Promise.all([
        rpc(admin.client, "approve_opportunity", { p_opportunity_id: id as string, p_notes: null, p_expected_version: ver }),
        rpc(admin.client, "reject_opportunity", { p_opportunity_id: id as string, p_reason: "nope" }),
      ]);
      const row = psql(`select status||'|'||coalesce(rejected_reason,'')||'|'||(approved_at is not null) from opportunities where id='${id}'`);
      const [status, reason, approvedAt] = row.split("|");
      expect(
        !(status === "approved" && reason) && !(status === "rejected" && approvedAt === "t"),
        `round ${round}: incoherent row ${row}`,
      ).toBe(true);
    }
  });

  test("poster edits while admin approves: edit_version guard stops a stale approval of changed content", async () => {
    for (let round = 0; round < 5; round += 1) {
      const poster = await make(`teP${round}`);
      const admin = await make(`teA${round}`, { admin: true });
      const { data: id } = await poster.client.rpc("submit_opportunity", validOpportunity());
      const ver = Number(psql(`select edit_version from opportunities where id='${id}'`));
      const [ap, ed] = await Promise.all([
        rpc(admin.client, "approve_opportunity", { p_opportunity_id: id as string, p_notes: null, p_expected_version: ver }),
        rpc(poster.client, "update_opportunity", { ...validOpportunity({ p_description: "EDITED AFTER ADMIN LOOKED — different content entirely." }), p_id: id as string, p_expected_version: ver }),
      ]);
      for (const r of [ap, ed]) if (r.error) expect(r.error.message).not.toMatch(LEAKY);
      const row = psql(`select status||'|'||left(description,6)||'|'||edit_version from opportunities where id='${id}'`);
      const approvedEdited = row.startsWith("approved|EDITED");
      const approvalSucceeded = !ap.error;
      const editSucceeded = !ed.error;
      // Unsafe: admin approved version `ver`, edit also succeeded, and the live row now shows
      // content the admin never reviewed — with no re-review queued.
      if (approvedEdited && approvalSucceeded && editSucceeded) {
        const queued = Number(psql(`select count(*) from listing_edits where listing_id='${id}'`));
        expect(queued, `round ${round}: unreviewed edit went live (${row})`).toBeGreaterThan(0);
      }
    }
  });

  test("two parallel updates with the same expected_version: exactly one wins", async () => {
    const poster = await make("verRace");
    const admin = await make("verAdmin", { admin: true });
    const { data: id } = await poster.client.rpc("submit_opportunity", validOpportunity());
    const ver = Number(psql(`select edit_version from opportunities where id='${id}'`));
    const out = await burst(6, (i) => rpc(poster.client, "update_opportunity", { ...validOpportunity({ p_description: `variant ${i} — long enough to pass validation` }), p_id: id as string, p_expected_version: ver }));
    const results = out.map((o) => (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value);
    const wins = results.filter((r) => !r.error).length;
    for (const r of results) if (r.error) expect(r.error.message).not.toMatch(LEAKY);
    expect(wins, `lost updates: ${wins} writers all believed they won`).toBe(1);
    void admin;
  });

  test("delete racing approve, edit and mark leaves no orphan rows (30 rounds)", async () => {
    const poster = await make("dEp");
    const admin = await make("dEa", { admin: true });
    let orphans = 0;
    for (let round = 0; round < 30; round++) {
      const { data: id } = await poster.client.rpc("submit_opportunity", validOpportunity());
      const ver = Number(psql(`select edit_version from opportunities where id='${id}'`));
      await admin.client.rpc("approve_opportunity", { p_opportunity_id: id as string, p_notes: null, p_expected_version: ver });
      const ver2 = Number(psql(`select edit_version from opportunities where id='${id}'`));
      await Promise.all([
        poster.client.from("opportunities").delete().eq("id", id as string),
        rpc(poster.client, "update_opportunity", { ...validOpportunity({ p_description: "late edit after approve — long enough" }), p_id: id as string, p_expected_version: ver2 }),
        rpc(poster.client, "mark_listing_action", { p_kind: "opportunity", p_id: id as string, p_action: "applied" }),
      ]);
      orphans += Number(psql(`select count(*) from listing_edits where listing_id='${id}'`)) +
        Number(psql(`select count(*) from user_listing_actions where listing_id='${id}'`));
    }
    // F7: mark_listing_action's insert share-locks the listing row, so it
    // serialises with the delete instead of landing after its cleanup trigger.
    expect(orphans, "orphan listing_edits / user_listing_actions rows after delete races").toBe(0);
  });

  test("mark/unmark applied 40× in parallel from one user ends consistent with no raw errors", async () => {
    const poster = await make("mkP");
    const admin = await make("mkA", { admin: true });
    const { data: id } = await poster.client.rpc("submit_opportunity", validOpportunity());
    const ver = Number(psql(`select edit_version from opportunities where id='${id}'`));
    await admin.client.rpc("approve_opportunity", { p_opportunity_id: id as string, p_notes: null, p_expected_version: ver });
    const out = await burst(40, (i) => rpc(poster.client, i % 2 ? "mark_listing_action" : "unmark_listing_action", { p_kind: "opportunity", p_id: id as string, p_action: "applied" }));
    for (const o of out) {
      const r = (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value;
      if (r.error) expect(r.error.message).not.toMatch(LEAKY);
    }
    expect(Number(psql(`select count(*) from user_listing_actions where listing_id='${id}'`))).toBeLessThanOrEqual(1);
  });

  test("events and VC/grants: parallel approve is as safe as opportunities", async () => {
    const poster = await make("evP");
    const admin = await make("evA", { admin: true });
    const { data: eid, error: e1 } = await poster.client.rpc("submit_event", validEvent());
    const { data: vid, error: e2 } = await poster.client.rpc("submit_vc_grant", validVc());
    expect(e1?.message).toBeUndefined();
    expect(e2?.message).toBeUndefined();
    const ev = Number(psql(`select edit_version from events where id='${eid}'`));
    const vv = Number(psql(`select edit_version from vcs_grants where id='${vid}'`));
    const out = await Promise.all([
      ...Array.from({ length: 4 }, () => rpc(admin.client, "approve_event", { p_event_id: eid as string, p_notes: null, p_expected_version: ev })),
      ...Array.from({ length: 4 }, () => rpc(admin.client, "approve_vc_grant", { p_id: vid as string, p_notes: null, p_expected_version: vv })),
    ]);
    for (const r of out) if (r.error) expect(r.error.message).not.toMatch(LEAKY);
  });
});

test.describe("community + misc", () => {
  // Posting is behind a kill switch that is off by default; the RPC-only config
  // has no global-setup to turn it on, so these specs set what they need.
  test.beforeAll(async () => {
    await service().from("app_config").upsert({ key: "community_posts_enabled", value: "true" }, { onConflict: "key" });
  });
  test("toggle_post_like ×25 from one user never exceeds one like", async () => {
    const m = await make("likeUser");
    const { data: post, error } = await m.client.rpc("create_post", { p_title: "adv post", p_body: "body of the adversarial post", p_images: [] });
    expect(error?.message).toBeUndefined();
    const postId = String((Array.isArray(post) ? post[0] : post)?.id ?? post);
    const out = await burst(25, () => rpc(m.client, "toggle_post_like", { p_post_id: postId }));
    for (const o of out) {
      const r = (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value;
      if (r.error) expect(r.error.message).not.toMatch(LEAKY);
    }
    const n = Number(psql(`select count(*) from post_likes where post_id='${postId}' and user_id='${m.id}'`));
    expect(n).toBeLessThanOrEqual(1);
  });

  test("create_post flood: is there any ceiling on posts per member per minute?", async () => {
    const m = await make("postFlood");
    const out = await burst(60, (i) => rpc(m.client, "create_post", { p_title: `flood ${i}`, p_body: "flood body flood body", p_images: [] }));
    const okN = out.filter((o) => (o as PromiseFulfilledResult<Awaited<ReturnType<typeof rpc>>>).value.error === null).length;
    test.info().annotations.push({ type: "observation", description: `${okN}/60 flooded posts accepted` });
    expect(okN, "unbounded post creation straight through the RPC").toBeLessThan(60);
  });

  test("approve_user vs reject_user concurrently: exactly one wins, never both", async () => {
    const admin = await make("uaAdmin", { admin: true });
    const target = await make("uaTarget", { status: "pending_review" });
    const [approve, reject] = await Promise.all([
      rpc(admin.client, "approve_user", { p_user_id: target.id, p_notes: null }),
      rpc(admin.client, "reject_user", { p_user_id: target.id, p_reason: "race" }),
    ]);
    // reject_user deletes the member (there is no "rejected" row to find), so
    // the two valid end states are "approved" or "gone", and the loser must
    // have been refused rather than silently succeeding as well.
    const row = psql(`select status from profiles where id='${target.id}'`);
    if (row === "approved") {
      expect(approve.error, "approve won but reported failure").toBeNull();
      expect(reject.error, "reject also reported success on an approved member").not.toBeNull();
    } else {
      expect(row, "the member is neither approved nor deleted").toBe("");
      expect(reject.error, "reject won but reported failure").toBeNull();
      expect(approve.error, "approve also reported success on a deleted member").not.toBeNull();
    }
  });

  test("direct PostgREST writes: a member cannot self-approve, self-promote, or touch another profile", async () => {
    const m = await make("esc", { status: "pending_review" });
    const other = await make("escVictim");
    const db = m.client;
    const attempts = await Promise.all([
      db.from("profiles").update({ status: "approved" }).eq("id", m.id).select(),
      db.from("profiles").update({ role: "admin" as never }).eq("id", m.id).select(),
      db.from("profiles").update({ first_name: "HACKED" }).eq("id", other.id).select(),
      db.from("admins").insert({ user_id: m.id }).select(),
      db.from("opportunities").update({ status: "approved" }).eq("posted_by", m.id).select(),
    ]);
    expect(Number(psql(`select count(*) from admins where user_id='${m.id}'`))).toBe(0);
    expect(psql(`select status from profiles where id='${m.id}'`)).toBe("pending_review");
    expect(psql(`select first_name from profiles where id='${other.id}'`)).not.toBe("HACKED");
    void attempts;
  });

  test("service role is never exposed: anon key cannot call admin RPCs or read other users' emails", async () => {
    const anon = (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const r = await anon.rpc("admin_list_profiles", { p_query: "", p_roles: null, p_statuses: null, p_courses: null, p_sectors: null, p_skills: null, p_grad_min: null, p_grad_max: null, p_limit: 5, p_offset: 0 } as never);
    expect(r.error, "anon must be refused").not.toBeNull();
    const t = await anon.from("profiles").select("*").limit(5);
    expect((t.data ?? []).length, "anon read profile rows").toBe(0);
    void service;
  });
});
