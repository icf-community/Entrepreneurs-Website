#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · The whole suite, in one script
#
#   bash scripts/regression.sh
#
# lint → typecheck → vitest → build → Playwright, in that order, with the
# BUILD IN THE SAME SCRIPT AS THE PLAYWRIGHT RUN. That is the point of the
# file: `pnpm build` earlier and `pnpm e2e` later is testing a build you
# did not just make, and this repo has already lost an afternoon to it.
#
# Assumes a local Supabase stack is up (`supabase start`) and migrated
# (`supabase db reset`). The four SQL suites are separate and run against
# the container directly:
#
#   for f in rls_smoke adversarial_edges admission_roles verify_prod_schema; do
#     docker exec -i supabase_db_EntrepreneursWebsite psql -U postgres \
#       -d postgres -v ON_ERROR_STOP=1 -q < ../supabase/tests/$f.sql
#   done
#
# ─── WHY THE ENV BLOCK EXISTS ───────────────────────────────────────
# `frontend/.env.local` holds PRODUCTION credentials and `next start`
# reads it, so a bare `pnpm build && pnpm e2e` points the E2E server at
# the live project. assert-local-env.mjs catches the Supabase half and
# aborts — it did, which is how this script came to exist — but the rest
# of .env.local would still have been inherited, including a real Resend
# key that sends real mail.
#
# Process env outranks every .env file, so exporting here is what makes
# the run safe. This mirrors what CI's e2e job does by simply not having
# a .env.local at all.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

eval "$(supabase status -o env --workdir .. 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"

if [ -z "${API_URL:-}" ]; then
  echo "No local Supabase stack. Run: supabase start && supabase db reset" >&2
  exit 1
fi

export NEXT_PUBLIC_SUPABASE_URL="${API_URL}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}"

# Blank, not unset. An empty value still beats .env.local's, and the code
# reads empty as "not configured" (`rateLimitEnabled = Boolean(url && token)`).
export UPSTASH_REDIS_REST_URL="" UPSTASH_REDIS_REST_TOKEN=""
export UPSTASH_CACHE_REDIS_REST_URL="" UPSTASH_CACHE_REDIS_REST_TOKEN=""
# A real key would send real mail. The suite asserts on rows in the
# outbound_email queue, which is the boundary the server actions own.
export RESEND_API_KEY=""
# Any value, as long as the server and the test agree. Without one the
# digest test skips itself rather than failing, which is worse.
export CRON_SECRET="e2e-local-regression"

echo "▸ Supabase: ${NEXT_PUBLIC_SUPABASE_URL}"

pnpm lint
pnpm typecheck
# Vitest, with the CACHE vars UNSET rather than blank. lib/cache.ts reads
# them with `??`, so an empty string is a configured value to it — the
# module then runs with a Redis URL of "" and cache.test.ts's first case
# sees its loader called twice. lib/ratelimit.ts uses `Boolean(url &&
# token)`, which is why blanking is right there and wrong here.
#
# Unsetting is safe for this phase specifically: vitest does not read
# .env.local, so there is no production value underneath to fall through
# to. `next start` does, which is why the blanks above stay in place for
# the build and Playwright phases below.
( unset UPSTASH_CACHE_REDIS_REST_URL UPSTASH_CACHE_REDIS_REST_TOKEN; pnpm test )
pnpm build
# Same project scoping as CI's e2e job. `ratelimit` is deliberately out:
# it needs a live Upstash surface (CI gives it one via an SRH sidecar in
# its own job), and the limiter is blanked above — so running it here
# would only prove it is switched off, while a process-wide limiter would
# make the rest of the suite flaky.
pnpm exec playwright test \
  --project=public --project=member --project=admin \
  --project=pipelines --project=connections
