#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Prod-like latency in front of the local stack (S0, gap 40)
#
#   scripts/perf/latency-up.sh          # start (idempotent)
#   scripts/perf/latency-up.sh --down   # stop and remove
#
# Locally the app reaches Supabase in well under a millisecond; in prod a
# Vercel function in fra1 reaches Supabase in London in ~15–20 ms per
# round trip, and a browser further still. Races, double submits and
# timeouts that a zero-latency stack hides show up here. Toxiproxy sits on
# 127.0.0.1:54331 in front of the local Supabase API (54321) and adds
# 10 ms ±5 each way (~20 ms per round trip); with redis-up.sh running it
# also fronts the Upstash stand-in on 127.0.0.1:8089 (+50 ms ±40).
#
# Use it with E2E_LATENCY=1 (scripts/local-env.sh points the build at the
# proxy). Local only: the upstreams are fixed to this machine.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
NAME=foundry-toxiproxy
IMAGE=ghcr.io/shopify/toxiproxy:2.9.0@sha256:b44c283298cea49e2defaba1b3028783798346f2a926684e3a345fd8441af3b8
if [[ "${1:-}" == "--down" ]]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "latency proxy stopped."
  exit 0
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p 127.0.0.1:54331:54331 -p 127.0.0.1:8089:8089 \
    --add-host host.docker.internal:host-gateway "$IMAGE" >/dev/null
  # The perf Redis stand-in lives on its own network; join it when present.
  docker network inspect foundry-perf >/dev/null 2>&1 && docker network connect foundry-perf "$NAME" || true
  for _ in $(seq 1 30); do
    docker exec "$NAME" /toxiproxy-cli list >/dev/null 2>&1 && break
    sleep 0.2
  done
fi

cli() { docker exec "$NAME" /toxiproxy-cli "$@" >/dev/null 2>&1 || true; }

cli create -l 0.0.0.0:54331 -u host.docker.internal:54321 supabase
cli toxic add -n down -t latency -a latency=10 -a jitter=5 --downstream supabase
cli toxic add -n up   -t latency -a latency=10 -a jitter=5 --upstream supabase

if docker network inspect foundry-perf >/dev/null 2>&1; then
  cli create -l 0.0.0.0:8089 -u foundry-perf-srh:80 redis
  cli toxic add -n down -t latency -a latency=50 -a jitter=40 --downstream redis
fi

docker exec "$NAME" /toxiproxy-cli list
echo "Supabase via http://127.0.0.1:54331 (+~20 ms per round trip)."
