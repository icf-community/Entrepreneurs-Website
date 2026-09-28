#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Build and run the E2E suite locally, with CI's environment
#
#   scripts/e2e-local.sh                 # full suite
#   scripts/e2e-local.sh e2e/home.spec.ts --project member
#
# `next build` and `next start` load .env.local, and this repo's
# .env.local holds PRODUCTION credentials (Resend, the service-role key,
# the cron secret, Upstash). CI has none of them. This script makes a local
# run match CI: every key .env.local defines is set to "" in the process
# environment (which outranks every .env file), then the local Supabase
# stack's values and CI's throwaway cron secret are exported on top.
#
# It rebuilds every time: never test a build you did not just make.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

# Blank every secret or endpoint the files define (keys, secrets, tokens,
# URLs). Plain config such as CONTACT_INBOX_EMAIL is left alone: code reads
# it as `env ?? default`, and "" would defeat the default where CI's unset
# variable doesn't.
for f in .env.local .env.production.local .env.production .env; do
  [[ -f "$f" ]] || continue
  for key in $(grep -oE '^[A-Z_][A-Z0-9_]*=' "$f" | tr -d '=' | grep -E '(KEY|SECRET|TOKEN|PASSWORD|_URL|_DSN)$'); do
    export "$key="
  done
done

eval "$(supabase status -o env --workdir .. 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
[[ "${API_URL:-}" =~ ^http://(127\.0\.0\.1|localhost) ]] || { echo "Local Supabase is not running (supabase start)." >&2; exit 1; }
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export CRON_SECRET="e2e-cron-secret"

node scripts/assert-local-env.mjs --mode production
pnpm build
exec ./node_modules/.bin/playwright test "$@"
