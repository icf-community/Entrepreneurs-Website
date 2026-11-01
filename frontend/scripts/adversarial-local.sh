#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Adversarial sweep against the LOCAL stack (about 10 minutes)
#
#   pnpm test:adversarial                  # DB-only specs, then the browser specs
#   pnpm test:adversarial --project=adv-ai # extra args go to the browser run only
#
# local-env.sh keeps production credentials out; the build is made fresh.
# ai-live.spec.ts spends real money and stays skipped unless it is asked for
# explicitly (see its header).
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/local-env.sh
pnpm build
./node_modules/.bin/playwright test -c playwright.rpc.config.ts
exec ./node_modules/.bin/playwright test -c playwright.adversarial.config.ts "$@"
