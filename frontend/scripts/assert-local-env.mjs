#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Refuse to start a dev server pointed at a remote Supabase.
//
// `next dev` loads .env.local automatically, and this repo's .env.local
// holds PRODUCTION credentials — so the default, most obvious command
// (`npm run dev`) used to boot a hot-reloading dev server with a service-role
// key for the live project. Every seed script, every stray click through an
// admin queue, every half-finished migration test lands on real members.
//
// That has already cost this project once: a script sourced .env.local and
// seeded three users and an admin into production.
//
// So the dev script asks this first. A remote host is a hard stop, not a
// warning, because a warning scrolls past.
//
// To deliberately point a local server at a remote project (rare, and worth
// having to think about), set ALLOW_REMOTE_SUPABASE=1 for that one command.
// ════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from "node:fs";

// This runs before Next boots, so Next has not loaded any .env file yet and
// process.env is bare. To judge what the server is about to connect to, the
// guard has to resolve the env the same way Next.js will.
//
// Next's precedence, highest first: the real process environment, then the
// mode-specific local file, .env.local, the mode file, .env. First file to
// define a key wins; later ones do not override it.
//
// THE MODE MATTERS. `next dev` reads .env.development.local; `next start`
// reads .env.production.local and never looks at the development file at
// all. Checking the development file while the server about to run is
// `next start` reports an env nobody is using — which is how a Playwright
// run against a production build ended up talking to the PRODUCTION Upstash
// cache while this guard sat one directory away printing a green tick.
//
// Pass `--mode production` (playwright.config.ts's webServer does) or set
// NODE_ENV; default is development, matching `pnpm dev`.
const modeArg = process.argv.indexOf("--mode");
const MODE =
  (modeArg > -1 ? process.argv[modeArg + 1] : undefined) ??
  (process.env.NODE_ENV === "production" ? "production" : "development");

const ENV_FILES = [`.env.${MODE}.local`, ".env.local", `.env.${MODE}`, ".env"];

// An ABSENT key and an EMPTY key are different things, and the difference
// is the whole mechanism this file exists to police. @next/env assigns a
// key only when `process.env[key]` is still undefined, so the first file
// that DEFINES a key wins — including when it defines it as "". That is
// precisely how a dev file opts out of a production value it would
// otherwise inherit from .env.local: `KEY=` is an override, `KEY` missing
// is a fall-through.
//
// So this returns on the first file that mentions the key at all, empty or
// not. Skipping empties instead would report the value Next is NOT going
// to use, which is worse than not checking.
function resolve(key) {
  if (key in process.env) return { value: process.env[key] ?? "", from: "process env" };
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      if (line.slice(0, eq).trim() !== key) continue;
      return { value: line.slice(eq + 1).trim().replace(/^["']|["']$/g, ""), from: file };
    }
  }
  return { value: "", from: null };
}

const { value: url, from } = resolve("NEXT_PUBLIC_SUPABASE_URL");
const escape = process.env.ALLOW_REMOTE_SUPABASE === "1";

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

const die = (lines) => {
  const w = 74;
  console.error("\n\x1b[41m\x1b[37m" + " ".repeat(w) + "\x1b[0m");
  console.error("\x1b[41m\x1b[37m  REFUSING TO START — dev server is pointed at a remote database".padEnd(w) + "\x1b[0m");
  console.error("\x1b[41m\x1b[37m" + " ".repeat(w) + "\x1b[0m\n");
  for (const l of lines) console.error("  " + l);
  console.error("");
  process.exit(1);
};

if (escape) {
  console.warn("\x1b[33m⚠  ALLOW_REMOTE_SUPABASE=1 — dev server is talking to a REMOTE Supabase.\x1b[0m");
  process.exit(0);
}

if (!url) {
  die([
    "NEXT_PUBLIC_SUPABASE_URL is not set.",
    "",
    "Start the local stack and copy its values into frontend/.env.development.local:",
    "",
    "  npx supabase@2.105.0 start",
    "  npx supabase@2.105.0 status -o env",
    "",
    "See .env.example for the full list of variables.",
  ]);
}

let host;
try {
  host = new URL(url).host;
} catch {
  die([`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${url}`]);
}

if (!LOCAL.test(new URL(url).origin)) {
  die([
    `NEXT_PUBLIC_SUPABASE_URL resolves to \x1b[1m${host}\x1b[0m, which is not localhost.`,
    `It is coming from \x1b[1m${from}\x1b[0m.`,
    "",
    ".env.local in this repo holds PRODUCTION credentials, and `next dev`",
    "loads it by default.",
    "",
    "Fix it by giving dev its own env, which Next.js loads at higher priority:",
    "",
    "  npx supabase@2.105.0 start",
    "  npx supabase@2.105.0 status -o env   # copy API_URL + PUBLISHABLE_KEY + SECRET_KEY",
    "  # into frontend/.env.development.local",
    "",
    "If you genuinely meant to point at a remote project:",
    "",
    "  ALLOW_REMOTE_SUPABASE=1 pnpm dev",
  ]);
}

console.log(`\x1b[32m✓\x1b[0m Supabase → ${host}  (local, from ${from}) [${MODE}]`);

// ── Upstash ─────────────────────────────────────────────────────────
// Same fall-through, different blast radius. lib/cache.ts keys entries
// `cache:v1:<name>` with no environment discriminator, so a dev server
// holding the production cache credentials writes local test data under
// the exact keys production reads back — and the taxonomy TTLs are an
// hour. Nothing warns, because from the cache's side a write is a write.
//
// This is not hypothetical here: .env.local carries the production
// UPSTASH_CACHE_* pair, and a .env.development.local that simply omits
// them inherits it. The fix is to set them EMPTY in the dev file, which
// makes caching and rate limiting no-ops; an empty value reads as unset
// to both modules.
//
// Blank passes. A remote host is a hard stop, on the same reasoning as
// Supabase above and behind the same escape hatch.
for (const key of [
  "UPSTASH_CACHE_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_URL",
]) {
  const { value, from: origin } = resolve(key);
  if (!value) continue;
  let upstashHost;
  try {
    upstashHost = new URL(value).host;
  } catch {
    die([`${key} is not a valid URL: ${value}`]);
  }
  if (!LOCAL.test(new URL(value).origin)) {
    die([
      `${key} resolves to \x1b[1m${upstashHost}\x1b[0m, which is not localhost.`,
      `It is coming from \x1b[1m${origin}\x1b[0m.`,
      "",
      "That is the PRODUCTION cache. Cache keys carry no environment",
      "discriminator, so a dev server writing to it serves local test data",
      "to real members for up to an hour.",
      "",
      "Set it empty in frontend/.env.development.local — an absent key",
      "falls through to .env.local, an empty one does not:",
      "",
      `  ${key}=`,
      "",
      "Caching and rate limiting are then no-ops locally, which is correct.",
    ]);
  }
}
console.log("\x1b[32m✓\x1b[0m Upstash  → not set (cache + rate limiting are local no-ops)");
