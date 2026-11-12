#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · A local Upstash stand-in for load tests (E1b)
#
#   scripts/perf/redis-up.sh          # start (idempotent)
#   scripts/perf/redis-up.sh --down   # stop and remove
#
# Production caches reads and rate-limits writes through Upstash. Without
# it locally, cached() never caches and every limiter is a no-op, so a
# load test overstates DB work and never sees a limit. This runs Redis
# plus serverless-redis-http (the same pinned images CI's rate-limit job
# uses) on 127.0.0.1:8079 with a throwaway token. Local only.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
NET=foundry-perf
if [[ "${1:-}" == "--down" ]]; then
  docker rm -f foundry-perf-srh foundry-perf-redis >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "perf redis stopped."
  exit 0
fi
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
docker ps --format '{{.Names}}' | grep -qx foundry-perf-redis ||
  docker run -d --name foundry-perf-redis --network "$NET" redis:7-alpine >/dev/null
docker ps --format '{{.Names}}' | grep -qx foundry-perf-srh ||
  docker run -d --name foundry-perf-srh --network "$NET" -p 127.0.0.1:8079:80 \
    -e SRH_MODE=env -e SRH_TOKEN=perf-token -e SRH_CONNECTION_STRING=redis://foundry-perf-redis:6379 \
    hiett/serverless-redis-http:latest@sha256:5b0bb9239fce53abf87b2018a7a0deb9ec7bd900c5360738fe5fbeeb426f9150 >/dev/null
echo "perf redis on http://127.0.0.1:8079 (token perf-token)."
