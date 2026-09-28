#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Build and serve the app for a LOCAL load test (E1b/E1c)
#
#   scripts/perf-serve.sh                    # http://127.0.0.1:3100, metrics on
#   PERF_INSTANCES=3 scripts/perf-serve.sh   # 3100-3102, like several instances
#
# Same environment isolation as the E2E runner (local-env.sh), plus
# PERF_METRICS=1 so server DB/Auth timings land in .perf/metrics.jsonl for
# perf-summary.mjs, and a local Upstash stand-in so caching and rate limits
# behave as in production. Rebuilds every time, then refreshes the server-action
# ids the k6 write mix needs for this build.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/local-env.sh
export PERF_METRICS=1
# Production's cache and rate limits, against a local stand-in
# (scripts/perf/redis-up.sh). PERF_REDIS=0 measures without them.
if [[ "${PERF_REDIS:-1}" == "1" ]]; then
  ../scripts/perf/redis-up.sh
  export UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079
  export UPSTASH_REDIS_REST_TOKEN=perf-token
fi
pnpm build
node scripts/loadtest-actions.mjs
# Production runs many Vercel instances; one local Node process saturates
# its single JS thread long before the database does, and then every
# timing is event-loop queueing. PERF_INSTANCES=N starts N servers on
# 3100, 3101, …; pass them to k6 as BASES=http://127.0.0.1:3100,… .
n="${PERF_INSTANCES:-1}"
pids=()
for ((i = 0; i < n; i++)); do
  ./node_modules/.bin/next start -p $((3100 + i)) -H 127.0.0.1 &
  pids+=($!)
done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT INT TERM
wait
