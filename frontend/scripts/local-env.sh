# ════════════════════════════════════════════════════════════════════
# Foundry · Point this shell at the LOCAL stack, never at production
#
#   source scripts/local-env.sh      # from frontend/
#
# `next build` and `next start` load .env.local, and this repo's
# .env.local holds PRODUCTION credentials (Resend, the service-role key,
# the cron secret, Upstash). This blanks every secret or endpoint those
# files define (keys, secrets, tokens, URLs) in the process environment,
# which outranks every .env file, then exports the local Supabase stack's
# values and CI's throwaway cron secret on top. Plain config such as
# CONTACT_INBOX_EMAIL is left alone: code reads it as `env ?? default`,
# and "" would defeat the default where CI's unset variable doesn't.
#
# Shared by e2e-local.sh and perf-serve.sh so the two can't drift.
# ════════════════════════════════════════════════════════════════════

for f in .env.local .env.production.local .env.production .env; do
  [[ -f "$f" ]] || continue
  for key in $(grep -oE '^[A-Z_][A-Z0-9_]*=' "$f" | tr -d '=' | grep -E '(KEY|SECRET|TOKEN|PASSWORD|_URL|_DSN)$'); do
    export "$key="
  done
done

eval "$(supabase status -o env --workdir .. 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
[[ "${API_URL:-}" =~ ^http://(127\.0\.0\.1|localhost) ]] || { echo "Local Supabase is not running (supabase start)." >&2; exit 1; }
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
# E2E_LATENCY=1: build and test through scripts/perf/latency-up.sh's proxy,
# which adds a prod-like ~20 ms per round trip (S0). The server, the
# browser and the test fixtures all reach Supabase through it.
if [[ "${E2E_LATENCY:-}" == "1" ]]; then
  curl -sf -o /dev/null -H "apikey: $ANON_KEY" http://127.0.0.1:54331/rest/v1/ ||
    { echo "E2E_LATENCY=1 but the latency proxy is not up (scripts/perf/latency-up.sh)." >&2; exit 1; }
  export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54331"
fi
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export CRON_SECRET="e2e-cron-secret"
# The AI spec starts the executor and the projection worker against this
# database with the fake provider, which refuses any non-local host.
export E2E_DB_URL="${DB_URL:-}"
# gap 24: opt-in only. Every other spec (e.g. community.spec.ts) documents
# and relies on UPLOAD_GATEWAY_URL being unset — it's how the suite proves
# the "no gateway configured" degradation path — so this stays off unless
# cv-upload.spec.ts is the thing actually running. Values must match
# e2e/gateway-services.ts's GATEWAY_URL/TICKET_SECRET exactly.
if [[ "${E2E_CV_UPLOAD:-}" == "1" ]]; then
  export UPLOAD_GATEWAY_URL="http://127.0.0.1:8000"
  export UPLOAD_TICKET_SECRET="e2e-cv-upload-ticket-secret"
fi

node scripts/assert-local-env.mjs --mode production
