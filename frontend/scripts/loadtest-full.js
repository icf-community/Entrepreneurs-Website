// ════════════════════════════════════════════════════════════════════
// Foundry · Full-coverage spike tests (k6): 500-VU burst and 500-VU sustained
//
//   SCENARIO=burst     BASES=http://127.0.0.1:3100,... k6 run frontend/scripts/loadtest-full.js
//   SCENARIO=sustained BASES=...                       k6 run frontend/scripts/loadtest-full.js
//
// Needs (all LOCAL): minted sessions (mint-loadtest-sessions.mjs), action ids for
// this build (loadtest-actions.mjs), SUPABASE_ANON_KEY from `supabase status -o env`.
//
//   burst      0 → VUS in BURST_RAMP seconds, hold BURST_HOLD s, drop. A spike, not a ramp.
//   sustained  ramp to VUS in 30 s, hold SUSTAINED_HOLD s (default 660 = 11 min), drop.
//
// Population: ~70% signed-in members, ~30% anonymous visitors (alternating by VU).
// A signed-in iteration walks EVERY member page, the detail pages, the API routes,
// and the write paths (bookmark, listing event, mark-read, AI turn when AI=1).
// An anonymous iteration walks every public page and the public API routes.
// Not covered, deliberately: sign-in (30/5 min/IP limiter), admin pages (no admin
// session minted), connection requests (see loadtest.js), file uploads, browser JS.
//
// A request FAILS if: status is 0/5xx/timeout, a signed-in page redirects or lacks
// its content (classifyPage), or a write does not report success. 429 is counted
// separately as `shed` — the app refusing deliberately — and is also a failure
// from the user's point of view, so it is included in `failed`.
// ════════════════════════════════════════════════════════════════════
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Trend, Rate, Counter } from "k6/metrics";
import { classifyPage } from "./loadtest-response.mjs";

const SCENARIO = __ENV.SCENARIO || "burst";
const BASES = (__ENV.BASES || __ENV.BASE || "http://127.0.0.1:3100").split(",").map((b) => b.trim());
const baseFor = () => BASES[(__VU - 1) % BASES.length];
const VUS = Number(__ENV.VUS ?? 500);
const THINK = Number(__ENV.THINK_SECONDS ?? 2);
const SUPABASE_URL = __ENV.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const AI = __ENV.AI === "1";
if (!ANON_KEY) throw new Error("SUPABASE_ANON_KEY required (export $(supabase status -o env | xargs)).");
if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL + BASES.join())) throw new Error("Local stack only.");

const ACTIONS = JSON.parse(open("./.loadtest-actions.json"));
const BOOKMARK = "app/opportunities/actions.ts#toggleOpportunityBookmark";
const SESSIONS = new SharedArray("sessions", () => JSON.parse(open("./.loadtest-sessions.json")).sessions);

const STAGES = SCENARIO === "sustained"
  ? [{ duration: "30s", target: VUS }, { duration: `${__ENV.SUSTAINED_HOLD ?? 660}s`, target: VUS }, { duration: "30s", target: 0 }]
  : [{ duration: `${__ENV.BURST_RAMP ?? 5}s`, target: VUS }, { duration: `${__ENV.BURST_HOLD ?? 120}s`, target: VUS }, { duration: "10s", target: 0 }];

export const options = {
  scenarios: { spike: { executor: "ramping-vus", startVUs: 0, stages: STAGES, gracefulRampDown: "60s", gracefulStop: "90s" } },
  maxRedirects: 0,
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max", "count"],
};

// name → [path, requiredText|"" , signedIn]
const MEMBER_PAGES = {
  home: ["/home", "Hello,"], events: ["/events", "Upcoming Foundry events"],
  opportunities: ["/opportunities", "Roles from the Foundry network"],
  members: ["/members", "The Foundry directory"], vcs: ["/vcs", "Funding for Foundry founders"],
  connections: ["/connections", 'aria-label="Connections views"'],
  connections_pending: ["/connections?tab=pending", 'aria-label="Connections views"'],
  connections_graph: ["/connections?view=graph", 'aria-label="Connections views"'],
  community: ["/community", ""], community_mine: ["/community/mine", ""],
  calendar: ["/calendar", ""], committee: ["/committee", ""], foundry_ai: ["/foundry-ai", ""],
  my_activity: ["/my-activity", ""], my_bookmarks: ["/my-bookmarks", ""],
  my_submissions: ["/my-submissions", ""], notifications: ["/notifications", ""],
  profile: ["/profile", ""], settings: ["/settings", ""],
  events_new: ["/events/new", ""], opportunities_new: ["/opportunities/new", ""], vcs_new: ["/vcs/new", ""],
};
const PUBLIC_PAGES = {
  landing: ["/", ""], login: ["/login", ""], contact: ["/contact", ""], privacy: ["/privacy", ""],
  terms: ["/terms", ""], cookies: ["/cookies", ""], ai_notice: ["/ai-notice", ""],
  committee_pub: ["/committee", ""], gated_events: ["/events", ""], gated_members: ["/members", ""],
  reset_password: ["/reset-password", ""],
};
const DETAIL = { event_detail: "/events/", opportunity_detail: "/opportunities/", vc_detail: "/vcs/" };
const API = { health: "/api/health", banner: "/api/banner" };
const WRITES = ["bookmark", "listing_event", "mark_read"];
const AI_STEPS = ["ai_submit", "ai_poll", "ai_cards", "ai_reopen"];

const names = [...Object.keys(MEMBER_PAGES).map((n) => `m_${n}`), ...Object.keys(PUBLIC_PAGES).map((n) => `p_${n}`),
  ...Object.keys(DETAIL), ...Object.keys(API), "cron_guard", ...WRITES, ...AI_STEPS];
const lat = {}, fail = {};
for (const n of names) { lat[n] = new Trend(`lat_${n}`, true); fail[n] = new Rate(`fail_${n}`); }

const reqTotal = new Counter("app_requests");
const reqFailed = new Counter("app_failed");
const reqShed = new Counter("app_shed_429");
const reqServerErr = new Counter("app_5xx");
const reqNetErr = new Counter("app_net_or_timeout");
const reqAuthRedirect = new Counter("app_auth_redirect");
const iterationsDone = new Counter("iterations_completed");
const aiTimeouts = new Counter("ai_poll_timeouts");
const aiOutcome = new Counter("ai_outcome_non_queued");
const codes = {};
for (const c of [200, 204, 304, 307, 401, 403, 404, 429, 500, 502, 503, 504, 0]) codes[c] = new Counter(`code_${c}`);
const codeOther = new Counter("code_other");

function record(name, res, ok) {
  reqTotal.add(1);
  lat[name].add(res.timings.duration);
  fail[name].add(!ok);
  (codes[res.status] || codeOther).add(1);
  if (res.status === 0) reqNetErr.add(1);
  else if (res.status === 429) reqShed.add(1);
  else if (res.status >= 500) reqServerErr.add(1);
  if (!ok) reqFailed.add(1);
  check(res, { [name]: () => ok });
}

function page(name, path, req, session) {
  const headers = { "Accept-Encoding": "gzip" };
  if (session) headers.Cookie = session.cookie;
  const res = http.get(`${baseFor()}${path}`, { headers, jar: new http.CookieJar(), tags: { route: name } });
  const r = classifyPage(res.status, res.body, Boolean(session), req);
  if (session && r.redirected) reqAuthRedirect.add(1);
  record(name, res, r.ok);
  if (THINK > 0) sleep(THINK);
}

function api(name, path, okCodes) {
  const res = http.get(`${baseFor()}${path}`, { jar: new http.CookieJar(), tags: { route: name } });
  record(name, res, okCodes.includes(res.status));
  if (THINK > 0) sleep(THINK / 2);
}

function rpc(name, fn, body, session) {
  const res = http.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, JSON.stringify(body), {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    tags: { route: name },
  });
  record(name, res, res.status >= 200 && res.status < 300);
  return res;
}

function bookmark(opp, session) {
  const base = baseFor();
  const res = http.post(`${base}/opportunities`, JSON.stringify([opp]), {
    headers: { "Next-Action": ACTIONS[BOOKMARK], "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: base, Cookie: session.cookie },
    jar: new http.CookieJar(), tags: { route: "bookmark" },
  });
  record("bookmark", res, res.status === 200 && typeof res.body === "string" && res.body.includes('"ok":true'));
}

function aiTurn(session) {
  const key = `lf-${__VU}-${__ITER}-${Date.now()}`;
  const sub = rpc("ai_submit", "ai_submit_turn", {
    p_mode: "network", p_conversation: null, p_opportunity: null, p_kind: "message",
    p_message: "Python and NumPy", p_idempotency_key: key, p_expected_revision: null, p_temporary: true,
  }, session);
  if (sub.status < 200 || sub.status >= 300) return;
  const row = (sub.json() || [])[0];
  if (!row || (row.outcome !== "queued" && row.outcome !== "duplicate")) { aiOutcome.add(1); return; }
  let etag = null, finished = false;
  for (let a = 0; a < 10 && !finished; a += 1) {
    sleep(a === 0 ? 0.5 : Math.min(2 * a, 4));
    const res = http.get(`${baseFor()}/api/ai/turns/${row.turn_id}`, {
      headers: { Cookie: session.cookie, ...(etag ? { "If-None-Match": etag } : {}) },
      jar: new http.CookieJar(), tags: { route: "ai_poll" },
    });
    const ok = res.status === 200 || res.status === 304;
    record("ai_poll", res, ok);
    if (!ok) return;
    if (res.status === 200) { etag = res.headers.ETag || etag; const b = res.json(); if (b && b.finished) finished = true; }
  }
  if (!finished) { aiTimeouts.add(1); return; }
  rpc("ai_cards", "ai_result_cards", { p_turn: row.turn_id }, session);
  if (row.conversation_id) rpc("ai_reopen", "ai_get_conversation", { p_conversation: row.conversation_id }, session);
}

export function setup() {
  const auth = { apikey: ANON_KEY, Authorization: `Bearer ${SESSIONS[0].accessToken}` };
  const ids = (table) => {
    const r = http.get(`${SUPABASE_URL}/rest/v1/${table}?select=id&status=eq.approved&limit=100`, { headers: auth });
    return r.status === 200 ? r.json().map((x) => x.id) : [];
  };
  const data = { opportunities: ids("opportunities"), events: ids("events"), vcs: ids("vcs_grants") };
  if (!data.opportunities.length || !data.events.length) throw new Error("Corpus not seeded: no approved events/opportunities.");
  for (let i = 0; i < SESSIONS.length; i += 1) {
    const res = http.get(`${BASES[0]}/home`, { headers: { Cookie: SESSIONS[i].cookie }, jar: new http.CookieJar(), timeout: "30s" });
    if (!classifyPage(res.status, res.body, true, "Hello,").ok) throw new Error(`Session ${i + 1} failed preflight; no load started.`);
  }
  return data;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export default function loadIteration(data) {
  if (__VU % 10 < 3) {
    // anonymous visitor
    for (const [n, [p, req]] of Object.entries(PUBLIC_PAGES)) page(`p_${n}`, p, req, null);
    api("health", API.health, [200]);
    api("banner", API.banner, [200, 204]);
    api("cron_guard", "/api/cron/health", [401, 403]);
  } else {
    const s = SESSIONS[(__VU - 1) % SESSIONS.length];
    for (const [n, [p, req]] of Object.entries(MEMBER_PAGES)) page(`m_${n}`, p, req, s);
    page("event_detail", `${DETAIL.event_detail}${pick(data.events)}`, "", s);
    page("opportunity_detail", `${DETAIL.opportunity_detail}${pick(data.opportunities)}`, "", s);
    if (data.vcs.length) page("vc_detail", `${DETAIL.vc_detail}${pick(data.vcs)}`, "", s);
    api("health", API.health, [200]);
    api("banner", API.banner, [200, 204]);
    const opp = pick(data.opportunities);
    bookmark(opp, s); bookmark(opp, s); // on then off: net zero
    rpc("listing_event", "record_listing_event", { p_kind: "opportunity", p_id: opp, p_event_type: "expand" }, s);
    rpc("mark_read", "mark_notifications_read", {}, s);
    if (AI) aiTurn(s);
  }
  iterationsDone.add(1);
}

export function handleSummary(data) {
  const m = data.metrics, v = (n, k) => (m[n] && m[n].values[k] != null ? m[n].values[k] : 0);
  const total = v("app_requests", "count"), failed = v("app_failed", "count");
  const pad = (s, n) => String(s).padEnd(n);
  let out = `\n════ ${SCENARIO} · ${VUS} VUs · ${BASES.length} app instance(s) ════\n`;
  out += `requests ${total}   failed ${failed}   success ${total ? (100 * (1 - failed / total)).toFixed(2) : 0}%\n`;
  out += `  5xx ${v("app_5xx", "count")}  429-shed ${v("app_shed_429", "count")}  conn-error/timeout ${v("app_net_or_timeout", "count")}  signed-in redirected ${v("app_auth_redirect", "count")}\n`;
  out += `iterations completed ${v("iterations_completed", "count")}   dropped_iterations n/a (ramping-vus)   http_req_failed ${(v("http_req_failed", "rate") * 100).toFixed(2)}%\n`;
  out += `status codes:`;
  for (const c of Object.keys(codes)) if (v(`code_${c}`, "count")) out += `  ${c === "0" ? "ERR" : c}:${v(`code_${c}`, "count")}`;
  if (v("code_other", "count")) out += `  other:${v("code_other", "count")}`;
  out += `\nai: poll-timeouts ${v("ai_poll_timeouts", "count")}  non-queued outcomes ${v("ai_outcome_non_queued", "count")}\n`;
  out += `\n${pad("route", 22)}${pad("n", 8)}${pad("fail%", 8)}${pad("p50", 9)}${pad("p95", 9)}${pad("p99", 9)}max (ms)\n`;
  const rows = names.filter((n) => v(`lat_${n}`, "count") > 0).map((n) => ({
    n, c: v(`lat_${n}`, "count"), f: 100 * v(`fail_${n}`, "rate"), p50: v(`lat_${n}`, "med"), p95: v(`lat_${n}`, "p(95)"), p99: v(`lat_${n}`, "p(99)"), mx: v(`lat_${n}`, "max"),
  })).sort((a, b) => b.p95 - a.p95);
  for (const r of rows) out += `${pad(r.n, 22)}${pad(r.c, 8)}${pad(r.f.toFixed(1), 8)}${pad(r.p50.toFixed(0), 9)}${pad(r.p95.toFixed(0), 9)}${pad(r.p99.toFixed(0), 9)}${r.mx.toFixed(0)}\n`;
  out += `\nLaptop run: read the ranking and the failure counts, not the milliseconds.\n`;
  return { stdout: out, [`${__ENV.OUT_PREFIX || "loadtest-full"}-${SCENARIO}-summary.json`]: JSON.stringify(data, null, 2) };
}
