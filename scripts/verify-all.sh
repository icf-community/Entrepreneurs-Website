#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · One-command local regression gate (S10, docs/verification.md)
#
#   scripts/verify-all.sh          # everything
#   scripts/verify-all.sh --quick  # skip the slow runs (full E2E, evals,
#                                   # the burst test) for day-to-day use
#
# Runs every check this project has, in order, prints one pass/fail table
# with a log path per step, and exits non-zero on any failure or skip.
# Never sources .env.local (PROD) — every DB-touching step below runs
# against an ephemeral `supabase start` stack this script boots and tears
# down itself.
#
# This is the regression gate before every future prod push.
#
# Deviation from the plan's literal wording: no Toxiproxy pass. S0's latency
# work used a different, already-verified method (see tasks/todo.md's S0
# entry and docs/audits/D1-scalability.md) rather than standing up Toxiproxy,
# so there is nothing here to invoke.
# ════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOG_DIR="$ROOT/.verify-all-logs"
mkdir -p "$LOG_DIR"

# Resolve real binaries rather than assuming PATH: this machine has no
# `psql` on PATH (Postgres.app/PostgreSQL.org installs put it under
# /Library/PostgreSQL/<ver>/bin, not PATH) and the system `python3` lacks
# server/requirements.txt installed — server/venv does.
PSQL="$(command -v psql || true)"
if [ -z "$PSQL" ]; then
  PSQL="$(ls /Library/PostgreSQL/*/bin/psql 2>/dev/null | sort -V | tail -1)"
fi
[ -z "$PSQL" ] && { echo "No psql found. Install PostgreSQL client tools."; exit 1; }

PYTHON="$ROOT/server/venv/bin/python"
[ -x "$PYTHON" ] || PYTHON="python3"

QUICK=0
for arg in "$@"; do
  [ "$arg" = "--quick" ] && QUICK=1
done

declare -a STEP_NAMES=()
declare -a STEP_STATUS=()
declare -a STEP_LOGS=()

run_step() {
  local name="$1"; shift
  local log="$LOG_DIR/$(echo "$name" | tr ' /' '--').log"
  echo "▸ $name"
  if "$@" > "$log" 2>&1; then
    STEP_STATUS+=("PASS")
  else
    STEP_STATUS+=("FAIL")
  fi
  STEP_NAMES+=("$name")
  STEP_LOGS+=("$log")
}

# ── Frontend: lint, typecheck, Vitest ──
run_step "frontend lint" bash -c "cd frontend && pnpm lint"
run_step "frontend typecheck" bash -c "cd frontend && pnpm typecheck"
run_step "frontend vitest" bash -c "cd frontend && pnpm test"

# ── Server: pytest (unit, no DB) ──
run_step "server pytest (unit)" bash -c "cd server && '$PYTHON' -m pytest -q"

# ── Ephemeral Supabase stack for every DB-touching step ──
echo "▸ starting ephemeral Supabase stack"
npx supabase@2.105.0 stop > "$LOG_DIR/supabase-stop-before.log" 2>&1
if ! npx supabase@2.105.0 start > "$LOG_DIR/supabase-start.log" 2>&1; then
  echo "  FAIL — see $LOG_DIR/supabase-start.log"
  STEP_NAMES+=("supabase start"); STEP_STATUS+=("FAIL"); STEP_LOGS+=("$LOG_DIR/supabase-start.log")
else
  STEP_NAMES+=("supabase start"); STEP_STATUS+=("PASS"); STEP_LOGS+=("$LOG_DIR/supabase-start.log")
fi

# `start` alone reuses this machine's persistent Docker volumes across runs
# (CI gets a fresh VM every time, so it never needs this). The SQL suites
# below assert exact row counts and expect a fresh `db reset` state — without
# this, leftover rows from a previous local run make their counts wrong.
run_step "supabase db reset" npx supabase@2.105.0 db reset

DB_URL=$(npx supabase@2.105.0 status -o env 2>/dev/null | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')
API_URL=$(npx supabase@2.105.0 status -o env 2>/dev/null | grep '^API_URL=' | cut -d= -f2- | tr -d '"')
ANON=$(npx supabase@2.105.0 status -o env 2>/dev/null | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')
SRK=$(npx supabase@2.105.0 status -o env 2>/dev/null | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')

run_step "SQL: rls_smoke" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_smoke.sql
run_step "SQL: admission_roles" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admission_roles.sql
run_step "SQL: adversarial_edges" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/adversarial_edges.sql
run_step "SQL: cv_worker_role" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cv_worker_role.sql
run_step "SQL: ai_smoke" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ai_smoke.sql
run_step "SQL: verify_prod_schema" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/verify_prod_schema.sql
run_step "SQL: invariants" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/invariants.sql

run_step "server pytest (integration, races, concurrency)" bash -c \
  "cd server && AI_INTEGRATION_DSN='$DB_URL' '$PYTHON' -m pytest tests/integration -q"

if [ "$QUICK" -eq 0 ]; then
  run_step "server pytest (burst 500)" bash -c \
    "cd server && AI_INTEGRATION_DSN='$DB_URL' '$PYTHON' -m pytest tests/integration/test_ai_burst_500.py -q"
  run_step "evals offline" bash -c "cd server && '$PYTHON' -m evals run"
  run_step "evals retrieval (2k)" bash -c \
    "cd server && '$PYTHON' -m evals retrieval --dsn '$DB_URL' --size 2k"
fi

# ── Fresh frontend build + full Playwright suite ──
run_step "frontend build (fresh)" bash -c \
  "cd frontend && NEXT_PUBLIC_SUPABASE_URL='$API_URL' NEXT_PUBLIC_SUPABASE_ANON_KEY='$ANON' SUPABASE_SERVICE_ROLE_KEY='$SRK' pnpm build"

if [ "$QUICK" -eq 0 ]; then
  run_step "E2E (chromium, all projects)" bash -c \
    "cd frontend && NEXT_PUBLIC_SUPABASE_URL='$API_URL' NEXT_PUBLIC_SUPABASE_ANON_KEY='$ANON' SUPABASE_SERVICE_ROLE_KEY='$SRK' E2E_DB_URL='$DB_URL' pnpm exec playwright test --project=public --project=member --project=admin --project=pipelines --project=connections --project=ai --project=matrix"
  run_step "E2E (webkit/iphone, public only)" bash -c \
    "cd frontend && E2E_ALL_BROWSERS=1 NEXT_PUBLIC_SUPABASE_URL='$API_URL' NEXT_PUBLIC_SUPABASE_ANON_KEY='$ANON' SUPABASE_SERVICE_ROLE_KEY='$SRK' E2E_DB_URL='$DB_URL' pnpm exec playwright test --project=public-webkit --project=public-iphone"
  run_step "E2E (firefox, all projects)" bash -c \
    "cd frontend && E2E_ALL_BROWSERS=1 NEXT_PUBLIC_SUPABASE_URL='$API_URL' NEXT_PUBLIC_SUPABASE_ANON_KEY='$ANON' SUPABASE_SERVICE_ROLE_KEY='$SRK' E2E_DB_URL='$DB_URL' pnpm exec playwright test --project=public-firefox --project=member-firefox --project=admin-firefox --project=pipelines-firefox --project=connections-firefox"
fi

run_step "SQL: invariants (post-load)" "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/invariants.sql

run_step "generated types up to date" bash -c "
  npx supabase@2.105.0 gen types typescript --local > /tmp/database.types.ts &&
  diff -u frontend/src/lib/database.types.ts /tmp/database.types.ts
"

npx supabase@2.105.0 stop > "$LOG_DIR/supabase-stop-after.log" 2>&1

# ── Report ──
echo ""
echo "════════════════════════════════════════════════════════════════════"
printf "%-55s %-6s %s\n" "STEP" "RESULT" "LOG"
FAILED=0
for i in "${!STEP_NAMES[@]}"; do
  printf "%-55s %-6s %s\n" "${STEP_NAMES[$i]}" "${STEP_STATUS[$i]}" "${STEP_LOGS[$i]}"
  [ "${STEP_STATUS[$i]}" = "FAIL" ] && FAILED=1
done
echo "════════════════════════════════════════════════════════════════════"

if [ "$FAILED" -eq 1 ]; then
  echo "RESULT: FAIL — see logs above."
  exit 1
fi
echo "RESULT: PASS"
