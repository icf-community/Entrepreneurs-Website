#!/usr/bin/env bash
#
# Foundry · pull an image and restart every enabled worker instance,
# verifying each comes back active before declaring success. Runs AS ROOT
# on foundry-worker. Sibling to infra/vm/foundry-release.sh (the
# gateway's equivalent) — kept separate rather than folded in because the
# two VMs now run genuinely different things: this one restarts NO
# gateway (there isn't one here), and has no HTTP endpoint to poll for
# health, unlike the gateway.
#
# Prints "FOUNDRY_DEPLOY_OK <ref>" on the last line ONLY when every
# enabled instance is confirmed active afterwards — same convention as
# foundry-release.sh, for the same reason: `az vm run-command invoke`
# reports success as soon as the script is delivered, not on the script's
# own exit code, so the CI caller greps stdout for this exact line.
set -euo pipefail

IMAGE_BASE="ghcr.io/icf-community/foundry-gateway"
REF="${1:-$IMAGE_BASE:latest}"

echo "==> pulling $REF"
. /etc/foundry/ghcr-pull.env
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
docker pull "$REF"

WORKERS="$(systemctl list-units --plain --no-legend 'foundry-worker@*.service' | awk '{print $1}')"
if [ -z "$WORKERS" ]; then
  echo "==> no worker instances enabled (systemctl enable --now foundry-worker@1)" >&2
  echo "no instances to restart — nothing deployed" >&2
  exit 1
fi

echo "==> restarting workers: $WORKERS"
# Sequential, not `systemctl restart $WORKERS`: one at a time keeps at
# least one worker draining the queue throughout the deploy. Each traps
# SIGTERM and finishes its current job first (ExecStop uses
# `docker stop -t 90`), so this is a drain, not a cut — same guarantee
# foundry-release.sh's identical restart loop relies on.
for unit in $WORKERS; do
  systemctl restart "$unit"
done

echo "==> health check"
# No HTTP endpoint to poll — the worker listens on nothing. "Healthy" here
# means every enabled instance is `active` a few seconds after restart,
# which catches an image that crash-loops immediately (a bad build, a
# missing env var) without waiting on the queue itself to prove anything.
sleep 3
FAILED=""
for unit in $WORKERS; do
  if ! systemctl is-active --quiet "$unit"; then
    FAILED="$FAILED $unit"
  fi
done

if [ -z "$FAILED" ]; then
  echo "FOUNDRY_DEPLOY_OK $REF"
  exit 0
fi

echo "not active after restart:$FAILED — recent logs:" >&2
for unit in $FAILED; do
  journalctl -u "$unit" -n 40 --no-pager >&2
done
exit 1
