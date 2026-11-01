import { test, expect } from "@playwright/test";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import {
  newMember, deleteMember, rpc, psql, LEAKY,
  validOpportunity, validEvent, validVc, type Member,
} from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Adversarial · hostile and boundary input straight at the write RPCs
//
// This is the layer BELOW the zod schemas: a script that skips the form
// (or a form that drifts from the schema) lands here. Two properties:
//   1. `refuse` rows: input that cannot be legitimate must be refused,
//      not stored.
//   2. Every refusal, whatever the input, must reach the member as a
//      sentence — never raw Postgres text. The RPC's own message may be
//      Postgres wording (a CHECK violation); what counts is what
//      describeSupabaseError, the single place the app turns an error into
//      text for a person, makes of it.
// ════════════════════════════════════════════════════════════════════

let m: Member;
test.beforeAll(async () => { m = await newMember("fuzz"); });
test.afterAll(async () => { await deleteMember(m); });

type Case = [name: string, over: Record<string, unknown>, expectation: "refuse" | "any"];

const long = (n: number) => "x".repeat(n);

const OPPORTUNITY: Case[] = [
  ["empty title", { p_position_name: "" }, "refuse"],
  ["whitespace-only title", { p_position_name: "   \n\t " }, "refuse"],
  ["zero-width-only title (looks blank)", { p_position_name: "​​​" }, "refuse"],
  ["NUL byte in title", { p_position_name: "a\u0000b" }, "refuse"],
  ["lone surrogate in description", { p_description: "bad \ud800 surrogate" }, "any"],
  ["RTL override in title", { p_position_name: "‮evil role" }, "any"],
  ["CRLF in single-line title", { p_position_name: "line1\r\nline2" }, "any"],
  ["script tag in title", { p_position_name: "<script>alert(1)</script>" }, "any"],
  ["SQL metachar in company", { p_company: "x'); drop table opportunities;--" }, "any"],
  ["title 5,000 chars", { p_position_name: long(5000) }, "refuse"],
  ["description 200,000 chars", { p_description: long(200_000) }, "refuse"],
  ["description 3,000,000 chars", { p_description: long(3_000_000) }, "refuse"],
  ["pay 5,000 chars", { p_pay: long(5000) }, "refuse"],
  ["deadline in the past", { p_application_deadline: "2020-01-01" }, "refuse"],
  ["deadline year 0001", { p_application_deadline: "0001-01-01" }, "refuse"],
  ["deadline year 9999", { p_application_deadline: "9999-12-31" }, "refuse"],
  ["deadline Feb 30", { p_application_deadline: "2027-02-30" }, "refuse"],
  ["start_month 0", { p_start_month: 0 }, "refuse"],
  ["start_month 13", { p_start_month: 13 }, "refuse"],
  ["start_month -1", { p_start_month: -1 }, "refuse"],
  ["start_month 40000 (smallint overflow)", { p_start_month: 40000 }, "refuse"],
  ["start_year 1900", { p_start_year: 1900 }, "refuse"],
  ["start_year 99999", { p_start_year: 99999 }, "refuse"],
  ["start_year 2^31", { p_start_year: 2 ** 31 }, "refuse"],
  ["apply_url javascript:", { p_apply_url: "javascript:alert(document.cookie)" }, "refuse"],
  ["apply_url data:", { p_apply_url: "data:text/html,<script>alert(1)</script>" }, "refuse"],
  ["apply_url file:", { p_apply_url: "file:///etc/passwd" }, "refuse"],
  ["apply_url scheme-relative", { p_apply_url: "//evil.example" }, "refuse"],
  ["apply_url 5,000 chars", { p_apply_url: `https://example.com/${long(5000)}` }, "refuse"],
  ["apply_method link with no url", { p_apply_method: "link", p_apply_url: null }, "refuse"],
  // An empty contact email falls back to the poster's signup address, so this
  // is legitimate (it was wrongly listed as "refuse").
  ["apply_method email with no contact email given", { p_apply_method: "email", p_apply_url: null, p_contact_email: "" }, "any"],
  ["contact_email missing @", { p_contact_email: "nobody" }, "refuse"],
  ["contact_email two @", { p_contact_email: "a@b@c.com" }, "refuse"],
  ["contact_email header injection", { p_contact_email: "a@b.com\r\nBcc: victim@example.com" }, "refuse"],
  ["contact_email 400 chars", { p_contact_email: `${long(390)}@example.com` }, "refuse"],
  ["skill id that doesn't exist", { p_skill_ids: [999999] }, "refuse"],
  ["duplicate skill ids", { p_skill_ids: [1, 1, 1, 1] }, "any"],
  ["negative skill id", { p_skill_ids: [-5] }, "refuse"],
  // 167 distinct real ids: over the 50-skill ceiling. (Repeats of a few ids
  // collapse to a few rows, which is harmless and stays accepted.)
  ["10,000 skill ids, 167 distinct", { p_skill_ids: Array.from({ length: 10_000 }, (_, i) => (i % 167) + 1) }, "refuse"],
  ["unknown eligible_audience", { p_eligible_audience: "everyone-and-their-dog" }, "refuse"],
  ["location onsite with no location text", { p_location_type: "onsite", p_location_text: null }, "any"],
];

const EVENT: Case[] = [
  ["event in the past", { p_event_at: "2019-01-01T10:00:00Z" }, "refuse"],
  ["event year 275760", { p_event_at: "+275760-09-13T00:00:00Z" }, "refuse"],
  ["event_at 'infinity'", { p_event_at: "infinity" }, "refuse"],
  ["event_at garbage", { p_event_at: "next tuesday-ish" }, "refuse"],
  ["luma_link javascript:", { p_luma_link: "javascript:alert(1)" }, "refuse"],
  ["luma_link not a url", { p_luma_link: "not a url" }, "refuse"],
  ["title NUL", { p_title: "ev\u0000il" }, "refuse"],
  ["organiser 10k chars", { p_organiser_name: long(10_000) }, "refuse"],
  ["description whitespace only", { p_description: "     " }, "refuse"],
];

const VC: Case[] = [
  ["kind invalid enum", { p_kind: "ponzi" }, "refuse"],
  ["link javascript:", { p_link: "javascript:alert(1)" }, "refuse"],
  ["deadline past", { p_deadline: "2020-05-05" }, "refuse"],
  ["amount 5k chars", { p_amount: long(5000) }, "refuse"],
  ["name NUL", { p_name: "fund\u0000" }, "refuse"],
];

async function sweep(fn: string, base: () => Record<string, unknown>, cases: Case[], table: string, idCol = "posted_by") {
  const failures: string[] = [];
  for (const [name, over, expectation] of cases) {
    const r = await rpc(m.client, fn, { ...base(), ...over });
    const shown = r.error ? describeSupabaseError({ code: r.error.code, message: r.error.message }) : "";
    if (r.error && LEAKY.test(shown)) failures.push(`LEAK   ${name}: ${shown.slice(0, 140)}`);
    if (!r.error && expectation === "refuse") failures.push(`STORED ${name}: accepted`);
    if (r.error && /^(5\d\d|FetchError)/.test(r.error.code ?? "") ) failures.push(`5XX    ${name}: ${r.error.code}`);
  }
  void table; void idCol; void psql;
  return failures;
}

test("submit_opportunity: hostile input is refused cleanly", async () => {
  const f = await sweep("submit_opportunity", () => validOpportunity(), OPPORTUNITY, "opportunities");
  expect(f, f.join("\n")).toEqual([]);
});

test("submit_event: hostile input is refused cleanly", async () => {
  const f = await sweep("submit_event", () => validEvent(), EVENT, "events");
  expect(f, f.join("\n")).toEqual([]);
});

test("submit_vc_grant: hostile input is refused cleanly", async () => {
  const f = await sweep("submit_vc_grant", () => validVc(), VC, "vcs_grants");
  expect(f, f.join("\n")).toEqual([]);
});

test("create_post: boundary and hostile bodies", async () => {
  const cases: Case[] = [
    ["empty body", { p_body: "", p_title: "t" }, "refuse"],
    ["whitespace body", { p_body: "   ", p_title: "t" }, "refuse"],
    ["NUL body", { p_body: "a\u0000b", p_title: "t" }, "refuse"],
    ["body 1,000,000 chars", { p_body: long(1_000_000), p_title: "t" }, "refuse"],
    ["title 10k chars", { p_title: long(10_000), p_body: "ok body ok body" }, "refuse"],
    ["images not an array", { p_images: "nope", p_title: "t", p_body: "ok body ok body" }, "refuse"],
    ["images pointing at a javascript: URL", { p_images: [{ key: "javascript:alert(1)" }], p_title: "t", p_body: "ok body ok body" }, "refuse"],
    ["images 500 entries", { p_images: Array.from({ length: 500 }, (_, i) => ({ key: `k${i}` })), p_title: "t", p_body: "ok body ok body" }, "refuse"],
  ];
  const f = await sweep("create_post", () => ({ p_title: "ok", p_body: "ok body ok body", p_images: [] }), cases, "posts", "author_id");
  expect(f, f.join("\n")).toEqual([]);
});

test("update_profile: hostile profile fields", async () => {
  const base = () => ({
    p_first_name: "Adv", p_surname: "Fuzz", p_course: "MEng Computing", p_grad_year: 2027,
    p_linkedin_url: null, p_github_url: null, p_portfolio_url: null, p_preferred_name: null,
    p_bio_focus: null, p_bio_hobbies: null, p_current_focus: null, p_venture_stage: null,
    p_venture_name: null, p_venture_url: null, p_venture_one_liner: null, p_recruiting_status: null,
    p_intent_urgency: null, p_availability_hours: null, p_skill_ids: [], p_core_skill_ids: [],
    p_sector_ids: [], p_academic_interests: [], p_hobbies: [], p_intents: [], p_expected_version: null,
  });
  const cases: Case[] = [
    ["first name empty", { p_first_name: "" }, "refuse"],
    ["first name NUL", { p_first_name: "A\u0000" }, "refuse"],
    ["first name 5k chars", { p_first_name: long(5000) }, "refuse"],
    ["first name <script>", { p_first_name: "<img src=x onerror=alert(1)>" }, "any"],
    ["grad_year 1800", { p_grad_year: 1800 }, "refuse"],
    ["grad_year 3000", { p_grad_year: 3000 }, "refuse"],
    ["linkedin javascript:", { p_linkedin_url: "javascript:alert(1)" }, "refuse"],
    ["linkedin not linkedin", { p_linkedin_url: "https://evil.example/in/me" }, "any"],
    ["github url data:", { p_github_url: "data:text/html;base64,PHNjcmlwdD4=" }, "refuse"],
    ["portfolio 5k chars", { p_portfolio_url: `https://e.com/${long(5000)}` }, "refuse"],
    ["venture_url javascript:", { p_venture_url: "javascript:alert(1)" }, "refuse"],
    ["bio 100k chars", { p_bio_focus: long(100_000) }, "refuse"],
    ["interests 10k entries", { p_academic_interests: Array.from({ length: 10_000 }, (_, i) => `i${i}`) }, "refuse"],
    ["interest with NUL", { p_hobbies: ["a\u0000b"] }, "refuse"],
    ["hobbies not strings", { p_hobbies: [1, null, {}] }, "refuse"],
    ["skill ids nonexistent", { p_skill_ids: [999999] }, "refuse"],
    ["stale expected_version", { p_expected_version: 99999 }, "refuse"],
    ["intents unknown value", { p_intents: ["world-domination"] }, "refuse"],
    ["recruiting_status unknown", { p_recruiting_status: "yes please" }, "refuse"],
  ];
  const f = await sweep("update_profile", base, cases, "profiles", "id");
  expect(f, f.join("\n")).toEqual([]);
});

test("connection note + report boundaries", async () => {
  const other = await newMember("fuzzNoteTarget");
  const { data: v } = await m.client.rpc("connection_consent_version");
  const f: string[] = [];
  const notes: [string, string | null, "refuse" | "any"][] = [
    ["note 301 chars", long(301), "refuse"],
    ["note NUL", "hi\u0000", "refuse"],
    ["note whitespace only", "    ", "any"],
    ["note with url+html", "<a href=javascript:alert(1)>hi</a>", "any"],
    ["bad consent version", null, "refuse"],
  ];
  for (const [name, note, ex] of notes) {
    const target = name === "note 301 chars" ? other : await newMember(`fuzzNote${name.length}`);
    const r = await rpc(m.client, "send_connection_request", {
      p_addressee: target.id,
      p_consent_version: name === "bad consent version" ? "v-not-real" : v,
      p_note: note,
    });
    if (r.error && LEAKY.test(r.error.message)) f.push(`LEAK ${name}: ${r.error.message}`);
    if (!r.error && ex === "refuse") f.push(`STORED ${name}`);
  }
  const bogus = await rpc(m.client, "send_connection_request", { p_addressee: "00000000-0000-0000-0000-000000000000", p_consent_version: v });
  if (bogus.error && LEAKY.test(bogus.error.message)) f.push(`LEAK nonexistent member: ${bogus.error.message}`);
  const self = await rpc(m.client, "send_connection_request", { p_addressee: m.id, p_consent_version: v });
  if (!self.error) f.push("STORED request to self");
  else if (LEAKY.test(self.error.message)) f.push(`LEAK self-request: ${self.error.message}`);
  expect(f, f.join("\n")).toEqual([]);
});

// F1 class sweep: the read side. Every list RPC that takes a date, cursor or
// number gets the extreme values a script (or a corrupted cursor) can send.
// A read must answer or refuse politely; it must never error in a way that
// would take the page down.
test("read RPCs: extreme dates, cursors and numbers answer or refuse cleanly", async () => {
  const EXTREME_TS = ["infinity", "-infinity", "0001-01-01T00:00:00Z", "9999-12-31T23:59:59Z", "not-a-date"];
  const EXTREME_INT = [0, -1, 2 ** 31 - 1, 2 ** 31, -(2 ** 31) - 1];
  const calls: [fn: string, args: Record<string, unknown>][] = [
    ...EXTREME_TS.map((v): [string, Record<string, unknown>] => ["list_community_feed", { p_cursor_created_at: v, p_cursor_id: "00000000-0000-0000-0000-000000000000" }]),
    ...EXTREME_TS.map((v): [string, Record<string, unknown>] => ["list_my_posts", { p_cursor_created_at: v, p_cursor_id: "00000000-0000-0000-0000-000000000000" }]),
    ...EXTREME_TS.map((v): [string, Record<string, unknown>] => ["list_my_notifications", { p_before: v }]),
    ...EXTREME_TS.map((v): [string, Record<string, unknown>] => ["list_my_connections", { p_cursor_decided_at: v, p_cursor_id: "00000000-0000-0000-0000-000000000000" }]),
    ...EXTREME_TS.map((v): [string, Record<string, unknown>] => ["list_my_pending_requests", { p_cursor_created_at: v, p_cursor_id: "00000000-0000-0000-0000-000000000000" }]),
    ...EXTREME_TS.map((v): [string, Record<string, unknown>] => ["list_my_sent_requests", { p_cursor_created_at: v, p_cursor_id: "00000000-0000-0000-0000-000000000000" }]),
    ...["infinity", "-infinity", "0001-01-01", "9999-12-31", "2027-02-30", "x"].flatMap((v): [string, Record<string, unknown>][] => [
      ["list_approved_vcs_grants", { p_from: v }], ["list_approved_vcs_grants", { p_to: v }]]),
    ...EXTREME_INT.flatMap((v): [string, Record<string, unknown>][] => [
      ["list_directory_cards", { p_grad_min: v }], ["list_directory_cards", { p_grad_max: v }],
      ["list_my_connections", { p_grad_min: v }], ["list_my_notifications", { p_limit: v }],
      ["list_community_feed", { p_limit: v }], ["list_approved_vcs_grants", { p_limit: v, p_offset: v }]]),
  ];
  const bad: string[] = [];
  for (const [fn, args] of calls) {
    const r = await rpc(m.client, fn, args);
    if (!r.error) continue;
    const shown = describeSupabaseError({ code: r.error.code, message: r.error.message });
    if (LEAKY.test(shown)) bad.push(`LEAK ${fn} ${JSON.stringify(args)}: ${shown}`);
    if (r.error.code === "PGRST202") bad.push(`NOFN ${fn}: wrong argument names in this test`);
  }
  expect(bad, bad.join("\n")).toEqual([]);
});
