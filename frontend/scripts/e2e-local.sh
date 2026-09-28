#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Build and run the E2E suite locally, with CI's environment
#
#   scripts/e2e-local.sh                 # full suite
#   scripts/e2e-local.sh e2e/home.spec.ts --project member
#
# local-env.sh makes the run match CI (no production credentials from
# .env.local). It rebuilds every time: never test a build you did not
# just make.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/local-env.sh
pnpm build
exec ./node_modules/.bin/playwright test "$@"
