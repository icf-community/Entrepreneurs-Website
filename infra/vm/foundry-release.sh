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
# Gateway-only. Until this session, the ingest worker instances also ran
# on this VM and this script restarted them too — the worker now runs on
# its own VM (foundry-worker), with its own release script
# (foundry-worker-release.sh), so that logic moved rather than staying
# here as dead weight restarting units that no longer exist on this host.
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
