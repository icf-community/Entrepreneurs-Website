// ════════════════════════════════════════════════════════════════════
// Foundry · C2 scalability audit, part 2: the burst load test (k6)
//
//   BASE=http://127.0.0.1:3100 k6 run frontend/scripts/loadtest.js
//   BASE=... STAGE=250 k6 run frontend/scripts/loadtest.js   # one level
//   BASE=... MODE=auth  k6 run frontend/scripts/loadtest.js  # signed in
//   BASE=... MODE=mixed k6 run frontend/scripts/loadtest.js  # both, contending
//
// MODE=auth and MODE=mixed need sessions minted first:
//   node frontend/scripts/mint-loadtest-sessions.mjs
//
// Ramps 100 → 250 → 500 concurrent virtual users, which is the plan's
// stated range (B3.7): a realistic post-announcement burst for a society
// of ~2000 members, NOT 2000 simultaneous requests. 2000 registered
// members do not produce 2000 concurrent ones, and testing the wrong
// number produces a scary chart and no decision.
//
// ──────────────────────────────────────────────────────────────────────
// WHAT THIS MEASURES HONESTLY
// ──────────────────────────────────────────────────────────────────────
// Run locally, this measures a laptop: one `next start` process, a
// Postgres container, and k6 all competing for the same 8 cores. The
// p99 numbers are NOT production numbers and must never be quoted as
// such. What it does tell you, and what production cannot be reasoned
// into telling you by reading code:
//
//   * WHICH route degrades first, and by how much relative to the others
//   * WHETHER the failure is queueing (latency climbs, errors stay at 0)
//     or exhaustion (errors appear) — a completely different fix each
//   * WHETHER Postgres connections are the wall, visible as errors
//     appearing simultaneously across every route at one VU level
//
// That ordering is the deliverable. Absolute latency comes later, from a
// run against deployed infrastructure.
//
// ──────────────────────────────────────────────────────────────────────
// THE TWO MODES, AND WHY THE ANONYMOUS ONE IS NOT ENOUGH
// ──────────────────────────────────────────────────────────────────────
// MODE=anon (default) is the original run and the honest shape of a
// burst: an announcement lands in front of people who are not signed in,
// and the landing page takes the hit.
//
// WHAT A GATED ROUTE ACTUALLY RETURNS TO A LOGGED-OUT CLIENT, because
// the 2026-09-08 audit got this wrong and drew a conclusion from it.
// Not a 3xx. `requireApprovedUser()` calls `redirect()`, but the root
// layout has already begun streaming by the time the page component
// awaits it, so the status line is out and Next has to deliver the
// redirect in-band: **HTTP 200, a complete HTML document** with the CSP
// nonce, the font preloads and the shell, carrying a client-side
// redirect. Verified by curl against this build; `expected_redirect`
// counts approximately nothing on those routes.
//
// So an anonymous hit on /events is NOT a cheap redirect — it is nearly
// a full render, missing only `listApprovedEvents` and the list markup,
// because the redirect fires before `loadEvents()`. Reading the old
// /events row as "middleware + redirect cost" understated it badly, and
// that misreading was very nearly the basis for dropping B3.3.
//
// It also means the anon-vs-auth delta on the same route isolates
// almost exactly the listing query plus its rendering — which is the
// thing B3.3 proposes to make cacheable.
//
// MODE=auth attaches a real session cookie so those pages actually
// render. MODE=mixed runs both populations at once, alternating by VU,
// because a burst is not homogeneous and contention between the cheap
// anonymous path and the expensive signed-in one is itself a finding.
//
// Sessions are minted OUT OF BAND by mint-loadtest-sessions.mjs, never
// by k6. Signing in 500 VUs would hammer GoTrue and measure the sign-in
// rate limiter's refusal rate rather than the app's throughput — the
// limiter allows 30 sign-ins per 5 minutes per IP, so the login itself
// would become the bottleneck under test.
//
// A signed-in request that 3xx's is NOT a pass. It means the session was
// rejected and the run has silently fallen back to timing redirects
// again. `auth_redirect` counts those and the summary refuses to let
// them pass quietly.
// ════════════════════════════════════════════════════════════════════

import http from "k6/http";
import { check, group } from "k6";
import { SharedArray } from "k6/data";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE || "http://127.0.0.1:3100";
const STAGE = __ENV.STAGE ? Number(__ENV.STAGE) : null;
const MODE = __ENV.MODE || "anon";

if (!["anon", "auth", "mixed"].includes(MODE)) {
  throw new Error(`MODE must be anon, auth or mixed — got "${MODE}".`);
}

// SharedArray so 500 VUs share one copy of the tokens rather than each
// parsing and holding their own. Loaded in init; open() is not available
// anywhere else.
const SESSIONS = new SharedArray("sessions", () => {
  if (MODE === "anon") return [];
  let file;
  try {
    file = open("./.loadtest-sessions.json");
  } catch {
    throw new Error(
      `MODE=${MODE} needs sessions. Run:\n` +
        "  export $(supabase status -o env | xargs)\n" +
        "  node frontend/scripts/mint-loadtest-sessions.mjs",
    );
  }
  const parsed = JSON.parse(file);
  if (!parsed.sessions || parsed.sessions.length === 0) {
    throw new Error("`.loadtest-sessions.json` holds no sessions — re-run the mint script.");
  }
  // An expired access token turns every signed-in hit back into a
  // redirect to /login, which would look like a fast page rather than a
  // broken run. Refuse the file instead of quietly measuring nothing.
  const now = Math.floor(Date.now() / 1000);
  if (parsed.soonestExpiry <= now + 300) {
    throw new Error(
      "`.loadtest-sessions.json` is expired or expires within 5 minutes. Re-run the mint script.",
    );
  }
  return parsed.sessions;
});

// Per-route latency, so the report can rank routes rather than emit one
// global p95 that hides which page is the problem.
const routeLatency = {
  home: new Trend("route_home", true),
  events: new Trend("route_events", true),
  opportunities: new Trend("route_opportunities", true),
  vcs: new Trend("route_vcs", true),
  committee: new Trend("route_committee", true),
  legal: new Trend("route_legal", true),
  login: new Trend("route_login", true),
  members_redirect: new Trend("route_members_redirect", true),
  // Signed-in routes are separate series, never merged with the
  // anonymous ones: in MODE=mixed the same path is a rendered page for
  // half the VUs and a redirect for the other half, and averaging those
  // together would produce a number that describes neither.
  home_auth: new Trend("route_home_auth", true),
  events_auth: new Trend("route_events_auth", true),
  opportunities_auth: new Trend("route_opportunities_auth", true),
  members_auth: new Trend("route_members_auth", true),
  vcs_auth: new Trend("route_vcs_auth", true),
};
const errors = new Rate("route_errors");
const expectedRedirect = new Counter("expected_redirect");
const authRedirect = new Counter("auth_redirect");

// Ramp-and-hold at each level rather than a single ramp to 500: a
// sustained plateau is where connection pools and event loops actually
// saturate. A pure ramp can sail through a level it could not have held.
const FULL_STAGES = [
  { duration: "20s", target: 100 },
  { duration: "40s", target: 100 },
  { duration: "20s", target: 250 },
  { duration: "40s", target: 250 },
  { duration: "20s", target: 500 },
  { duration: "60s", target: 500 },
  { duration: "20s", target: 0 },
];

export const options = {
  stages: STAGE
    ? [
        { duration: "20s", target: STAGE },
        { duration: "60s", target: STAGE },
        { duration: "10s", target: 0 },
      ]
    : FULL_STAGES,
  // No thresholds that abort the run. The point is to find where it
  // breaks and report what broke — a run that aborts at the first
  // threshold breach throws away the measurement it exists to take.
  thresholds: {},
  // Redirects are the thing being measured on protected routes, so do
  // not let k6 silently follow them and time two requests as one.
  maxRedirects: 0,
  discardResponseBodies: false,
  // "count" is here so handleSummary can tell an untouched route from a
  // fast one. A Trend's `values` carries only the stats named here — it
  // has no implicit count the way a Counter does — so without this every
  // route filters out as unsampled and the table prints empty.
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
};

// `session` is undefined for anonymous hits and a minted session for
// signed-in ones. The cookie goes on as an explicit header rather than
// through k6's per-VU jar: the jar would absorb whatever the app set on
// the way back, and a rotated cookie mid-run would make it ambiguous
// which credential each timing was taken with.
function hit(name, path, session) {
  const headers = { "Accept-Encoding": "gzip" };
  if (session) headers.Cookie = session.cookie;

  const res = http.get(`${BASE}${path}`, { tags: { route: name }, headers });
  routeLatency[name].add(res.timings.duration);

  const redirected = res.status >= 300 && res.status < 400;
  const served = res.status >= 200 && res.status < 300;

  if (session) {
    // A signed-in request must RENDER. A 3xx here is the session being
    // rejected — expired token, wrong Supabase, an unapproved member —
    // and it silently turns the measurement back into redirect timing,
    // which is the precise defect this mode was added to fix. So it is
    // an error, not an expected redirect.
    if (redirected) authRedirect.add(1);
    errors.add(!served);
    check(res, { [`${name} rendered while signed in`]: () => served });
    return res;
  }

  if (redirected) expectedRedirect.add(1);

  // 2xx is a served page — including a gated route answering a logged-out
  // client, which is a 200 carrying a client-side redirect, not a 3xx
  // (see the header). A real 3xx still happens on a few paths and is
  // fine. Everything else — 5xx, a connection reset, a timeout surfaced
  // as status 0 — is a real failure.
  const ok = served || redirected;
  errors.add(!ok);
  check(res, { [`${name} served or redirected`]: () => ok });
  return res;
}

// A session, not a single URL: a real visitor lands, reads the two
// listing boards, and bounces off one gated page. Weighting matters —
// /events is where an announcement points, so it is hit twice.
function anonymousBurst() {
  group("anonymous burst", () => {
    hit("home", "/");
    hit("events", "/events");
    hit("opportunities", "/opportunities");
    hit("events", "/events");
    hit("vcs", "/vcs");
    hit("committee", "/committee");
    hit("members_redirect", "/members");
    hit("login", "/login");
    hit("legal", "/privacy");
  });
}

// The same announcement, read by someone who is already a member: they
// land on /home rather than the marketing page, and the two gated boards
// that were 3xx above are now full renders. /members is included because
// the directory is the heaviest read in the product (Finding 1) and the
// one page whose cost genuinely varies with the corpus size.
function signedInBurst(session) {
  group("signed-in burst", () => {
    hit("home_auth", "/home", session);
    hit("events_auth", "/events", session);
    hit("opportunities_auth", "/opportunities", session);
    hit("events_auth", "/events", session);
    hit("members_auth", "/members", session);
    hit("vcs_auth", "/vcs", session);
  });
}

export default function () {
  // Spread VUs across the minted members rather than reusing one: a
  // single auth.uid() gets unrealistically warm plans and page caches.
  const session = SESSIONS.length ? SESSIONS[(__VU - 1) % SESSIONS.length] : null;

  if (MODE === "auth") {
    signedInBurst(session);
    return;
  }
  if (MODE === "mixed") {
    // Alternate by VU, not by iteration, so each VU keeps one identity
    // for the whole run and the two populations stay evenly sized at
    // every ramp level.
    if (__VU % 2 === 0) signedInBurst(session);
    else anonymousBurst();
    return;
  }
  anonymousBurst();
}

export function handleSummary(data) {
  const m = data.metrics;
  const g = (n, s) => (m[n] && m[n].values[s] != null ? m[n].values[s].toFixed(1) : "—");

  const rows = Object.keys(routeLatency)
    // A mode only exercises some routes; an untouched Trend would print
    // a row of em-dashes and pad the ranking with nothing.
    .filter((r) => m[`route_${r}`] && m[`route_${r}`].values.count > 0)
    .map((r) => ({
      route: r,
      p50: g(`route_${r}`, "med"),
      p95: g(`route_${r}`, "p(95)"),
      p99: g(`route_${r}`, "p(99)"),
      max: g(`route_${r}`, "max"),
    }))
    // Ranking by p95 is the deliverable: which route breaks FIRST.
    .sort((a, b) => Number(b.p95) - Number(a.p95));

  const pad = (s, n) => String(s).padEnd(n);
  let out = `\n════ route latency, ranked by p95 (ms) · MODE=${MODE} ════\n`;
  out += `${pad("route", 22)}${pad("p50", 10)}${pad("p95", 10)}${pad("p99", 10)}max\n`;
  for (const r of rows) {
    out += `${pad(r.route, 22)}${pad(r.p50, 10)}${pad(r.p95, 10)}${pad(r.p99, 10)}${r.max}\n`;
  }
  const errRate = m.route_errors ? (m.route_errors.values.rate * 100).toFixed(2) : "0";
  const authRedirects = m.auth_redirect ? m.auth_redirect.values.count : 0;
  out += `\nrequests: ${m.http_reqs ? m.http_reqs.values.count : 0}`;
  out += `   error rate: ${errRate}%`;
  out += `   expected redirects: ${m.expected_redirect ? m.expected_redirect.values.count : 0}\n`;

  if (authRedirects > 0) {
    out += `\n!! ${authRedirects} signed-in requests were REDIRECTED, not rendered.\n`;
    out += `!! The *_auth numbers above are redirect timings and must not be quoted.\n`;
    out += `!! Re-mint sessions, and check the app is pointed at the same Supabase.\n`;
  } else if (MODE !== "anon") {
    out += `\nAll signed-in requests rendered (0 redirects) — the *_auth rows are real page renders.\n`;
  }

  out += `\nRead the RANKING, not the milliseconds — this ran on a laptop`;
  out += `\nsharing cores with Postgres and k6 itself.\n`;

  return { stdout: out };
}
