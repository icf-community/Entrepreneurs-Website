// ════════════════════════════════════════════════════════════════════
// Foundry · C2 scalability audit, part 2: the burst load test (k6)
//
//   BASE=http://127.0.0.1:3100 k6 run frontend/scripts/loadtest.js
//   BASE=... STAGE=250 k6 run frontend/scripts/loadtest.js   # one level
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
// ANONYMOUS ONLY, DELIBERATELY
// ──────────────────────────────────────────────────────────────────────
// Every request here is logged out. Two reasons, both load-bearing:
//
//   1. It is the honest shape of the burst. An announcement lands in
//      front of people who are not signed in; the landing page is what
//      takes the hit.
//   2. Signing in 500 VUs would hammer GoTrue and the OTP rate limiter,
//      and would measure the limiter's refusal rate rather than the
//      app's throughput. The authenticated read paths are measured by
//      scale_query_plans.sql instead, where the RLS cost is visible
//      directly rather than through five layers of HTTP.
//
// Consequently the protected routes below are expected to 3xx/4xx to
// /login. That is a PASS: what is being timed is the middleware +
// redirect cost, which is the real per-request work an anonymous burst
// generates. `expected_redirect` counts them so they are never confused
// with failures.
// ════════════════════════════════════════════════════════════════════

import http from "k6/http";
import { check, group } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE || "http://127.0.0.1:3100";
const STAGE = __ENV.STAGE ? Number(__ENV.STAGE) : null;

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
};
const errors = new Rate("route_errors");
const expectedRedirect = new Counter("expected_redirect");

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
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function hit(name, path) {
  const res = http.get(`${BASE}${path}`, {
    tags: { route: name },
    headers: { "Accept-Encoding": "gzip" },
  });
  routeLatency[name].add(res.timings.duration);

  const redirected = res.status >= 300 && res.status < 400;
  if (redirected) expectedRedirect.add(1);

  // 2xx is a served page; 3xx on a protected route is the middleware
  // doing its job. Everything else — 5xx, a connection reset, a timeout
  // surfaced as status 0 — is a real failure.
  const ok = (res.status >= 200 && res.status < 300) || redirected;
  errors.add(!ok);
  check(res, { [`${name} served or redirected`]: () => ok });
  return res;
}

export default function () {
  // A session, not a single URL: a real visitor lands, reads the two
  // listing boards, and bounces off one gated page. Weighting matters —
  // /events is where an announcement points, so it is hit twice.
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

export function handleSummary(data) {
  const m = data.metrics;
  const g = (n, s) => (m[n] && m[n].values[s] != null ? m[n].values[s].toFixed(1) : "—");

  const rows = Object.keys(routeLatency)
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
  let out = "\n════ route latency, ranked by p95 (ms) ════\n";
  out += `${pad("route", 20)}${pad("p50", 10)}${pad("p95", 10)}${pad("p99", 10)}max\n`;
  for (const r of rows) {
    out += `${pad(r.route, 20)}${pad(r.p50, 10)}${pad(r.p95, 10)}${pad(r.p99, 10)}${r.max}\n`;
  }
  const errRate = m.route_errors ? (m.route_errors.values.rate * 100).toFixed(2) : "0";
  out += `\nrequests: ${m.http_reqs ? m.http_reqs.values.count : 0}`;
  out += `   error rate: ${errRate}%`;
  out += `   expected redirects: ${m.expected_redirect ? m.expected_redirect.values.count : 0}\n`;
  out += `\nRead the RANKING, not the milliseconds — this ran on a laptop`;
  out += `\nsharing cores with Postgres and k6 itself.\n`;

  return { stdout: out };
}
