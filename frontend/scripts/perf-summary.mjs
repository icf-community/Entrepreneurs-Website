#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Foundry · Plain-text load-test summary (launch programme E1c, M5)
//
//   node scripts/perf-summary.mjs [--dir .perf]
//
// Reads whatever of these exist in the directory and prints numbers to
// the terminal. No charts, no report files (owner, 2026-09-28): it is a
// tool for deciding what to optimise next, then re-running.
//
//   k6.json       k6 --out json=.perf/k6.json   (per-request points, tagged
//                 route and kind=read|write by loadtest.js)
//   metrics.jsonl server-side DB/Auth call timings (PERF_METRICS=1)
//   pgstat.csv    supabase/checks/pg_stat_snapshot.sql --csv
//   docker.jsonl  scripts/perf/sample-docker.sh
// ════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dirArg = process.argv.indexOf("--dir");
const DIR = dirArg > -1 ? process.argv[dirArg + 1] : ".perf";

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(n < 10 ? 1 : 0).padStart(7) : "      -");
const pad = (s, n) => String(s).slice(0, n).padEnd(n);

function lines(file) {
  const p = join(DIR, file);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function table(title, groups, { limit = 25 } = {}) {
  const rows = [...groups.entries()].map(([key, v]) => {
    const s = v.ms.sort((a, b) => a - b);
    return { key, n: s.length, total: s.reduce((a, b) => a + b, 0), p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), errors: v.errors };
  }).sort((a, b) => b.total - a.total).slice(0, limit);
  console.log(`\n${title}`);
  console.log(`${pad("", 52)}${"count".padStart(7)}${"p50".padStart(7)}${"p95".padStart(7)}${"p99".padStart(7)}${"total_s".padStart(9)}${"err".padStart(6)}`);
  for (const r of rows) {
    console.log(`${pad(r.key, 52)}${String(r.n).padStart(7)}${fmt(r.p50)}${fmt(r.p95)}${fmt(r.p99)}${(r.total / 1000).toFixed(1).padStart(9)}${String(r.errors).padStart(6)}`);
  }
}

function add(map, key, ms, error) {
  const g = map.get(key) ?? { ms: [], errors: 0 };
  g.ms.push(ms);
  if (error) g.errors++;
  map.set(key, g);
}

// ── k6: what the member experienced, per route ──────────────────────
const k6 = lines("k6.json");
if (k6) {
  const byRoute = new Map();
  const byKind = { read: 0, write: 0, other: 0 };
  let failed = 0, total = 0;
  for (const p of k6) {
    if (p.type !== "Point" || p.metric !== "http_req_duration") continue;
    const t = p.data.tags ?? {};
    const kind = t.kind === "read" || t.kind === "write" ? t.kind : "other";
    byKind[kind]++;
    total++;
    const bad = Number(t.status) >= 500 || t.status === "0";
    if (bad) failed++;
    add(byRoute, `${kind.padEnd(5)} ${t.route ?? t.name ?? "?"}`, p.data.value, bad);
  }
  console.log(`k6: ${total} requests · ${byKind.read} read / ${byKind.write} write / ${byKind.other} untagged · ` +
    `5xx or no response: ${failed} (${total ? ((100 * failed) / total).toFixed(2) : 0}%)`);
  table("k6 · request duration by route (ms)", byRoute);
}

// ── server: every DB/Auth call the app made ─────────────────────────
const m = lines("metrics.jsonl");
if (m) {
  const bySource = new Map();
  const byRoute = new Map();
  const kindCount = {}, kindMs = {};
  for (const l of m) {
    kindCount[l.kind] = (kindCount[l.kind] ?? 0) + 1;
    kindMs[l.kind] = (kindMs[l.kind] ?? 0) + l.ms;
    const bad = l.status >= 500 || l.status === 0;
    add(bySource, `${l.kind.padEnd(5)} ${l.source}`, l.ms, bad);
    add(byRoute, l.route, l.ms, bad);
  }
  const r = kindCount.read ?? 0, w = kindCount.write ?? 0;
  const rMs = kindMs.read ?? 0, wMs = kindMs.write ?? 0;
  console.log(`\nserver DB calls: ${m.length} · auth ${kindCount.auth ?? 0} · read ${r} · write ${w}`);
  console.log(`read/write ratio: by count ${w ? (r / w).toFixed(1) : "∞"}:1 · by time ${wMs ? (rMs / wMs).toFixed(1) : "∞"}:1 ` +
    // Judged by DB time, not call count: time is what uses up capacity.
    `→ ${rMs >= wMs ? "read-heavy: look at query plans, caching, fewer round trips" : "write-heavy: look at batching, locks, trigger cost"}`);
  table("server · DB/Auth call duration by source (ms)", bySource);
  table("server · DB/Auth time per route (ms per call)", byRoute, { limit: 15 });
}

// ── Postgres: the slowest statements ────────────────────────────────
const pgPath = join(DIR, "pgstat.csv");
if (existsSync(pgPath)) {
  const [header, ...rows] = readFileSync(pgPath, "utf8").trim().split("\n");
  console.log(`\npostgres · top statements by total time (pg_stat_statements)\n${header}`);
  for (const row of rows.slice(0, 12)) console.log(row.slice(0, 190));
}

// ── containers ──────────────────────────────────────────────────────
const d = lines("docker.jsonl");
if (d) {
  const by = new Map();
  for (const l of d) {
    const name = l.stat.Name.replace(/_[A-Za-z]+$/, "");
    const cpu = parseFloat(l.stat.CPUPerc);
    const g = by.get(name) ?? [];
    g.push(cpu);
    by.set(name, g);
  }
  console.log("\ncontainers · CPU % (100% = one core)");
  for (const [name, cpus] of by) {
    const s = cpus.sort((a, b) => a - b);
    console.log(`${pad(name, 30)} p50 ${fmt(pct(s, 50))}  p95 ${fmt(pct(s, 95))}  max ${fmt(s[s.length - 1])}`);
  }
}

if (!k6 && !m && !existsSync(pgPath) && !d) {
  console.error(`Nothing to summarise in ${DIR}. See the header of this script for the inputs.`);
  process.exit(1);
}
