#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Sample local container CPU/memory during a load run (E1c, M4)
#
#   scripts/perf/sample-docker.sh > frontend/.perf/docker.jsonl &   # start
#   kill %1                                                           # stop
#
# One JSON line per container every 2 s for the database, PostgREST, Auth
# and Kong containers.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
while true; do
  ts=$(date +%s)
  docker stats --no-stream --format '{{json .}}' \
    $(docker ps --format '{{.Names}}' | grep -E '^supabase_(db|rest|auth|kong)_') \
    | while IFS= read -r line; do printf '{"ts":%s,"stat":%s}\n' "$ts" "$line"; done
  sleep 2
done
