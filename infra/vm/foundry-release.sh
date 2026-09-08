#!/usr/bin/env bash
#
# Foundry · pull an image and restart the gateway, verifying health before
# declaring success. Runs AS ROOT on the VM.
#
# The one place "pull, restart, prove it's healthy" is implemented — both
# deploy.sh (over SSH, no argument, defaults to :latest) and the
# deploy-gateway.yml workflow (via `az vm run-command`, a commit-SHA tag)
# call this rather than each carrying their own copy, so the two paths
# cannot drift apart.
#
# Prints "FOUNDRY_DEPLOY_OK <ref>" on the last line ONLY when the gateway is
# confirmed healthy afterwards. `az vm run-command invoke` reports success
# as soon as the script is delivered — it does not surface the script's own
# exit code — so the CI caller greps stdout for this exact line rather than
# trusting the invocation's own status.
set -euo pipefail

IMAGE_BASE="ghcr.io/icf-community/foundry-gateway"
REF="${1:-$IMAGE_BASE:latest}"

echo "==> pulling $REF"
. /etc/foundry/ghcr-pull.env
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
docker pull "$REF"

# systemd's unit always runs $IMAGE_BASE:latest. When we were handed a
# SHA-pinned ref instead (CI does this so a deploy can't race a second push
# that moves :latest mid-flight), point :latest at exactly what we just
# pulled so the restart below picks up this specific build.
if [ "$REF" != "$IMAGE_BASE:latest" ]; then
  docker tag "$REF" "$IMAGE_BASE:latest"
fi

echo "==> restarting"
systemctl restart foundry-gateway

# The ingest worker instances share the gateway's image, so a deploy that
# restarted only the gateway would leave them running the previous build
# indefinitely. Each traps SIGTERM and finishes its current job first
# (ExecStop uses `docker stop -t 90`), so this is a drain, not a cut.
#
# Enumerated from systemd rather than hardcoded, so changing the instance
# count stays a `systemctl enable` away and never needs this script edited.
WORKERS="$(systemctl list-units --plain --no-legend 'foundry-worker@*.service' | awk '{print $1}')"
if [ -n "$WORKERS" ]; then
  echo "==> restarting workers: $WORKERS"
  # Sequential, not `systemctl restart $WORKERS`: one at a time keeps at
  # least one worker draining the queue throughout the deploy.
  for unit in $WORKERS; do
    systemctl restart "$unit"
  done
else
  echo "==> no worker instances enabled (systemctl enable --now foundry-worker@1)"
fi

echo "==> health check"
for _ in $(seq 1 10); do
  if curl -fsS --max-time 5 localhost:8000/health 2>/dev/null | grep -q '"ok"'; then
    echo "FOUNDRY_DEPLOY_OK $REF"
    exit 0
  fi
  sleep 1
done

echo "gateway did not become healthy within 10s. Recent logs:" >&2
journalctl -u foundry-gateway -n 40 --no-pager >&2
exit 1

# No HTTP health gate for the workers: they listen on nothing, so there is
# no endpoint to poll. Their liveness check is `systemctl is-active
# foundry-worker@N` plus "the queue is draining" — i.e. `jobs` not
# accumulating rows stuck in 'pending'.
