#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# CI wrapper for `playwright test`: a run that never exits fails loudly
# instead of holding the job for GitHub's 6-hour ceiling.
#
# Every PR run on feat/connections passed its tests and then hung until
# GitHub cancelled it at 6h — the list reporter never printed its summary,
# so Playwright was stuck between the last test and onEnd (web-server
# shutdown / teardown). Locally on macOS the same suite exits in seconds.
# When the limit passes this dumps the process tree and every pipe/socket
# the stragglers hold, which is what identifies the process keeping the
# run alive. DEBUG=pw:webserver logs the server's start and stop.
#
# Usage: PW_LIMIT_SECONDS=900 scripts/ci-playwright.sh --project=...
# ════════════════════════════════════════════════════════════════════
set -uo pipefail

limit="${PW_LIMIT_SECONDS:?set PW_LIMIT_SECONDS}"

DEBUG=pw:webserver pnpm exec playwright test "$@" &
pw=$!
start=$SECONDS

while kill -0 "$pw" 2>/dev/null; do
  if (( SECONDS - start > limit )); then
    echo "::error::playwright still running after ${limit}s — dumping process state"
    ps -eo pid,ppid,pgid,stat,etime,args --forest
    for p in $(pgrep -f 'next-server|next start|playwright|node ' || true); do
      echo "--- open pipes/sockets of $p: $(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | cut -c1-120)"
      ls -l /proc/$p/fd 2>/dev/null | grep -E 'pipe|socket' | head -20
    done
    kill -TERM "$pw" 2>/dev/null; sleep 5; kill -KILL "$pw" 2>/dev/null
    exit 1
  fi
  sleep 5
done

wait "$pw"
