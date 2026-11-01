import { expect, test } from "@playwright/test";
import { assertLocal, deleteMember, newMember, psql, rpc, service, validOpportunity, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// /admin/ai operator RPCs, called the way the server actions call them
// (app/admin/ai/actions.ts), but straight at the database, which is the real
// gate: every admin_* AI function checks the caller in its own body.
//
//   - a student, and an admin who is not an AI operator, are refused
//   - an operator can change a switch / limit, with a recorded reason
//   - bad input (unknown flag, short or long reason, out-of-range limits) is
//     refused and changes nothing
//   - the 25% step rule on the active-turn ceiling holds
//
// The settings row and flags are global state, so they are snapshotted and
// restored. The money caps are the AI-bill backstop: what an operator can and
// cannot do to them is pinned here (finding L-2, fixed in 20261026000010).
// ════════════════════════════════════════════════════════════════════

test.describe.configure({ mode: "serial" });

const FLAG = "ai_network_enabled";
let student: Member, plainAdmin: Member, operator: Member;
let settingsBefore: string;
let flagBefore: string;
let oppId: string | null = null;

const q = (s: string) => s.replace(/'/g, "''");

test.beforeAll(async () => {
  assertLocal();
  [student, plainAdmin, operator] = await Promise.all([
    newMember("aiadm-stu"),
    newMember("aiadm-plain", { admin: true }),
    newMember("aiadm-op", { admin: true }),
  ]);
  psql(`insert into ai_private.operators (member_id) values ('${operator.id}') on conflict do nothing`);
  settingsBefore = psql(`select to_jsonb(s) from ai_private.settings s where id = 1`);
  flagBefore = psql(`select value from public.app_config where key = '${FLAG}'`);
});

test.afterAll(async () => {
  if (settingsBefore) {
    psql(
      `update ai_private.settings s set active_turn_ceiling = r.active_turn_ceiling, ` +
        `matching_daily_cap_micro = r.matching_daily_cap_micro, member_daily_cap_micro = r.member_daily_cap_micro, ` +
        `previous = r.previous, updated_by = r.updated_by, reason = r.reason, updated_at = r.updated_at ` +
        `from jsonb_populate_record(null::ai_private.settings, '${q(settingsBefore)}'::jsonb) r where s.id = 1`,
    );
  }
  if (flagBefore) psql(`update public.app_config set value = '${flagBefore}' where key = '${FLAG}'`);
  if (oppId) await service().from("opportunities").delete().eq("id", oppId);
  psql(`delete from ai_private.operators where member_id = '${operator.id}'`);
  for (const m of [student, plainAdmin, operator]) if (m) await deleteMember(m);
});

const settingsNow = () => psql(`select to_jsonb(s) - 'updated_at' - 'updated_by' - 'reason' - 'previous' from ai_private.settings s where id = 1`);
const flagNow = () => psql(`select value from public.app_config where key = '${FLAG}'`);
const audits = (admin: string, action: string) =>
  Number(psql(`select count(*) from public.admin_actions where admin_id = '${admin}' and action = '${action}'`));

test("control: an operator really is one, and a plain admin is not", async () => {
  const op = await rpc(operator.client, "admin_ai_overview");
  const plain = await rpc(plainAdmin.client, "admin_ai_overview");
  expect(op.error, op.error?.message).toBeNull();
  expect(plain.error, "every admin may VIEW the overview").toBeNull();
  expect(psql(`select count(*) from ai_private.operators where member_id = '${plainAdmin.id}'`)).toBe("0");
});

test("a student cannot read the overview or call any operator RPC", async () => {
  const before = settingsNow();
  for (const [fn, args] of [
    ["admin_ai_overview", undefined],
    ["admin_set_ai_flag", { p_key: FLAG, p_enabled: false, p_reason: "student attempt" }],
    ["admin_set_ai_limits", { p_active_turn_ceiling: 20, p_matching_daily_cap_micro: 1, p_member_daily_cap_micro: 1, p_reason: "student attempt" }],
    ["admin_ai_rebuild_index", undefined],
  ] as const) {
    const r = await rpc(student.client, fn, args as Record<string, unknown> | undefined);
    expect(r.error, `student was allowed ${fn}`).not.toBeNull();
  }
  expect(settingsNow()).toBe(before);
  expect(flagNow()).toBe(flagBefore);
});

test("an admin who is not an AI operator can read but not change anything", async () => {
  const before = settingsNow();
  const flag = await rpc(plainAdmin.client, "admin_set_ai_flag", { p_key: FLAG, p_enabled: flagBefore !== "true", p_reason: "plain admin attempt" });
  const lim = await rpc(plainAdmin.client, "admin_set_ai_limits", { p_active_turn_ceiling: 21, p_matching_daily_cap_micro: 1, p_member_daily_cap_micro: 1, p_reason: "plain admin attempt" });
  const reb = await rpc(plainAdmin.client, "admin_ai_rebuild_index");
  for (const [name, r] of [["flag", flag], ["limits", lim], ["rebuild", reb]] as const) {
    expect(r.error?.code, `${name}: ${r.error?.message}`).toBe("42501");
    expect(r.error?.message, `${name} message is what the action maps to "Only AI operators"`).toContain("operators");
  }
  expect(settingsNow()).toBe(before);
  expect(flagNow()).toBe(flagBefore);
  expect(audits(plainAdmin.id, "ai_limits_changed")).toBe(0);
});

test("operator: a switch changes, is audited with its reason, and restores", async () => {
  const to = flagBefore === "true" ? "false" : "true";
  const reason = "adv: operator flag test";
  const r = await rpc(operator.client, "admin_set_ai_flag", { p_key: FLAG, p_enabled: to === "true", p_reason: reason });
  expect(r.error, r.error?.message).toBeNull();
  expect(flagNow()).toBe(to);
  const note = psql(`select notes from public.admin_actions where admin_id = '${operator.id}' and action in ('ai_flag_on','ai_flag_off') order by created_at desc limit 1`);
  expect(note).toBe(`${FLAG}: ${reason}`);
  const back = await rpc(operator.client, "admin_set_ai_flag", { p_key: FLAG, p_enabled: flagBefore === "true", p_reason: "adv: restore" });
  expect(back.error, back.error?.message).toBeNull();
  expect(flagNow()).toBe(flagBefore);
});

test("operator: unknown flags and bad reasons are refused and change nothing", async () => {
  const before = psql(`select count(*) from public.app_config`);
  for (const key of ["ai_admin", "'; drop table app_config; --", "", "AI_ENABLED", "site_banner"]) {
    const r = await rpc(operator.client, "admin_set_ai_flag", { p_key: key, p_enabled: true, p_reason: "adv: bad key" });
    expect(r.error?.code, `key ${JSON.stringify(key)}: ${r.error?.message}`).toBe("22023");
  }
  for (const reason of [null, "", "  ", "ab", "x".repeat(301)]) {
    const r = await rpc(operator.client, "admin_set_ai_flag", { p_key: FLAG, p_enabled: flagBefore === "true", p_reason: reason });
    expect(r.error?.code, `reason ${JSON.stringify(reason)?.slice(0, 20)}: ${r.error?.message}`).toBe("22023");
  }
  expect(psql(`select count(*) from public.app_config`)).toBe(before);
  expect(flagNow()).toBe(flagBefore);
});

test("operator: limits change, keep the previous values, and are audited", async () => {
  const cur = JSON.parse(psql(`select to_jsonb(s) from ai_private.settings s where id = 1`));
  const next = Math.min(50, Math.floor(cur.active_turn_ceiling * 1.2));
  const r = await rpc(operator.client, "admin_set_ai_limits", {
    p_active_turn_ceiling: next, p_matching_daily_cap_micro: cur.matching_daily_cap_micro, p_member_daily_cap_micro: cur.member_daily_cap_micro, p_reason: "adv: limits test",
  });
  expect(r.error, r.error?.message).toBeNull();
  const after = JSON.parse(psql(`select to_jsonb(s) from ai_private.settings s where id = 1`));
  expect(after.active_turn_ceiling).toBe(next);
  expect(after.previous.active_turn_ceiling, "the prior value is kept for rollback").toBe(cur.active_turn_ceiling);
  expect(after.reason).toBe("adv: limits test");
  expect(after.updated_by).toBe(operator.id);
  expect(audits(operator.id, "ai_limits_changed")).toBeGreaterThanOrEqual(1);
  // The monthly cap is not editable through this function, so it stays the outer bill ceiling.
  expect(after.matching_monthly_cap_micro).toBe(cur.matching_monthly_cap_micro);
});

test("operator: the active-turn ceiling cannot jump more than 25%", async () => {
  const cur = JSON.parse(psql(`select to_jsonb(s) from ai_private.settings s where id = 1`));
  const tooBig = Math.ceil(cur.active_turn_ceiling * 1.25) + 1;
  expect(tooBig, "setup: stay inside the column's own 1..50 range so only the step rule can refuse").toBeLessThanOrEqual(50);
  const r = await rpc(operator.client, "admin_set_ai_limits", {
    p_active_turn_ceiling: tooBig, p_matching_daily_cap_micro: cur.matching_daily_cap_micro, p_member_daily_cap_micro: cur.member_daily_cap_micro, p_reason: "adv: too big",
  });
  expect(r.error?.message).toContain("25%");
  expect(JSON.parse(psql(`select to_jsonb(s) from ai_private.settings s where id = 1`)).active_turn_ceiling).toBe(cur.active_turn_ceiling);
});

test("operator: out-of-range limits are refused by the table, and change nothing", async () => {
  const before = settingsNow();
  const cur = JSON.parse(psql(`select to_jsonb(s) from ai_private.settings s where id = 1`));
  const base = { p_active_turn_ceiling: cur.active_turn_ceiling, p_matching_daily_cap_micro: cur.matching_daily_cap_micro, p_member_daily_cap_micro: cur.member_daily_cap_micro, p_reason: "adv: range" };
  for (const bad of [{ p_active_turn_ceiling: 0 }, { p_active_turn_ceiling: 51 }, { p_active_turn_ceiling: -3 }, { p_member_daily_cap_micro: -1 }, { p_matching_daily_cap_micro: -5 }]) {
    const r = await rpc(operator.client, "admin_set_ai_limits", { ...base, ...bad });
    expect(r.error, `${JSON.stringify(bad)} was accepted`).not.toBeNull();
  }
  expect(settingsNow()).toBe(before);
});

test("L-2: the money caps have a hard ceiling, a 25% step rule, and can always be cut or restored", async () => {
  // Fixed in 20261026000010. The ceilings are sized to a $150/month OpenAI
  // budget: matching monthly $150, matching daily $10, per-member daily $1.
  const read = () => JSON.parse(psql(`select to_jsonb(s) from ai_private.settings s where id = 1`));
  const cur = read();
  const set = (matching: number, member: number, reason: string) =>
    rpc(operator.client, "admin_set_ai_limits", {
      p_active_turn_ceiling: cur.active_turn_ceiling, p_matching_daily_cap_micro: matching, p_member_daily_cap_micro: member, p_reason: reason,
    });
  try {
    // 1. Absurd values are refused with a plain sentence, and nothing changes.
    for (const [matching, member] of [[9_000_000_000_000, cur.member_daily_cap_micro], [cur.matching_daily_cap_micro, 9_000_000_000_000], [10_000_001, cur.member_daily_cap_micro], [cur.matching_daily_cap_micro, 1_000_001]]) {
      const before = settingsNow();
      const r = await set(matching, member, "adv: L-2 ceiling");
      expect(r.error, `${matching}/${member} was accepted`).not.toBeNull();
      expect(r.error!.code).toBe("22023");
      expect(r.error!.message).not.toMatch(/violates|constraint|check/i);
      expect(settingsNow(), "a refused call must change nothing").toBe(before);
    }
    // 2. Null limits are refused cleanly, not as a raw not-null error.
    const nul = await rpc(operator.client, "admin_set_ai_limits", {
      p_active_turn_ceiling: cur.active_turn_ceiling, p_matching_daily_cap_micro: null, p_member_daily_cap_micro: cur.member_daily_cap_micro, p_reason: "adv: L-2 null",
    });
    expect(nul.error?.code).toBe("22023");
    expect(nul.error!.message).not.toMatch(/violates|null value|constraint/i);
    // 3. Lowering is always allowed, including to zero (the emergency cut).
    const cut = await set(0, 0, "adv: L-2 emergency cut");
    expect(cut.error, cut.error?.message).toBeNull();
    expect([read().matching_daily_cap_micro, read().member_daily_cap_micro]).toEqual([0, 0]);
    // 4. From zero, a raise back to the column defaults is allowed (never stuck at 0)...
    const back = await set(5_000_000, 500_000, "adv: L-2 restore default");
    expect(back.error, back.error?.message).toBeNull();
    // 5. ...and above the default the step rule applies: +25% ok, +26% refused.
    const ok = await set(6_250_000, 625_000, "adv: L-2 plus 25 percent");
    expect(ok.error, ok.error?.message).toBeNull();
    const jump = await set(Math.ceil(6_250_000 * 1.26), 625_000, "adv: L-2 plus 26 percent");
    expect(jump.error?.code).toBe("22023");
    expect(jump.error!.message).toContain("25%");
    expect(read().matching_daily_cap_micro).toBe(6_250_000);
    // 6. The table CHECKs are the backstop for any other writer.
    for (const [col, v] of [["matching_monthly_cap_micro", 150_000_001], ["matching_daily_cap_micro", 10_000_001], ["member_daily_cap_micro", 1_000_001]] as const) {
      expect(() => psql(`update ai_private.settings set ${col} = ${v} where id = 1`), `${col} = ${v} was written directly`).toThrow();
    }
    // The monthly cap is still not editable through the RPC and still equals the budget.
    expect(read().matching_monthly_cap_micro).toBe(cur.matching_monthly_cap_micro);
    expect(read().matching_monthly_cap_micro).toBeLessThanOrEqual(150_000_000);
  } finally {
    psql(`update ai_private.settings set matching_daily_cap_micro = ${cur.matching_daily_cap_micro}, member_daily_cap_micro = ${cur.member_daily_cap_micro} where id = 1`);
  }
});

test("operator: rebuilding the index queues work and is audited", async () => {
  const r = await rpc(operator.client, "admin_ai_rebuild_index");
  expect(r.error, r.error?.message).toBeNull();
  expect(typeof r.data).toBe("number");
  expect(audits(operator.id, "ai_rebuild_index")).toBeGreaterThanOrEqual(1);
});

test("job audience: only an admin can set it, only to a valid value, and it is audited", async () => {
  const poster = student;
  const opp = await poster.client.rpc("submit_opportunity", validOpportunity());
  expect(opp.error, opp.error?.message).toBeNull();
  oppId = String(opp.data);
  const staged = await service().from("opportunities").update({ status: "approved", approved_at: new Date().toISOString(), eligible_audience: null }).eq("id", oppId);
  expect(staged.error, staged.error?.message).toBeNull();
  expect(psql(`select count(*) from public.opportunities where id = '${oppId}' and eligible_audience is null`), "setup: a job awaiting an audience").toBe("1");

  const byStudent = await rpc(student.client, "admin_set_opportunity_audience", { p_id: oppId, p_audience: "students" });
  expect(byStudent.error?.code).toBe("42501");
  expect(psql(`select coalesce(eligible_audience,'null') from public.opportunities where id = '${oppId}'`)).toBe("null");

  for (const bad of ["everyone", "", "STUDENTS", "students; drop table x"]) {
    const r = await rpc(plainAdmin.client, "admin_set_opportunity_audience", { p_id: oppId, p_audience: bad });
    expect(r.error, `audience ${JSON.stringify(bad)} accepted`).not.toBeNull();
  }
  const gone = await rpc(plainAdmin.client, "admin_set_opportunity_audience", { p_id: "00000000-0000-4000-8000-000000000000", p_audience: "both" });
  expect(gone.error?.code).toBe("P0002");
  expect(gone.error?.message).not.toMatch(/00000000-0000/);

  const ok = await rpc(plainAdmin.client, "admin_set_opportunity_audience", { p_id: oppId, p_audience: "graduates" });
  expect(ok.error, ok.error?.message).toBeNull();
  expect(psql(`select eligible_audience from public.opportunities where id = '${oppId}'`)).toBe("graduates");
  expect(audits(plainAdmin.id, "admin_set_opportunity_audience")).toBe(1);
  const queue = await rpc(plainAdmin.client, "admin_list_opportunities_needing_audience");
  expect((queue.data as { id: string }[]).some((o) => o.id === oppId), "audited job should leave the queue").toBe(false);
});
