#!/usr/bin/env bash
#
# Foundry · deploy the ingestion worker to its VM
#
#   ./deploy-worker.sh <vm-ip>              build, push, deploy the current server/
#   ./deploy-worker.sh <vm-ip> --bootstrap  first run: packages, docker, secrets — then deploy
#
# Sibling to deploy.sh (the gateway's equivalent), not a parameterised
# version of it — the two VMs differ enough (no nginx, no TLS cert, no
# HTTP health endpoint, N systemd instances instead of one) that sharing
# the script would mean threading a role flag through nearly every step.
#
# Same image as the gateway (one build, one registry entry, different
# ExecStart) — server/Dockerfile builds one image that serves both roles.
#
# Never reads .env.local — that file points at PRODUCTION Supabase and
# has no business here.
set -euo pipefail

VM_IP="${1:-}"
BOOTSTRAP=false
[[ "${2:-}" == "--bootstrap" ]] && BOOTSTRAP=true

[[ -n "$VM_IP" ]] || { echo "usage: $0 <vm-ip> [--bootstrap]" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
SSH="ssh -o StrictHostKeyChecking=accept-new azureuser@$VM_IP"
IMAGE="ghcr.io/icf-community/foundry-gateway:latest"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }

[[ -d "$SERVER_DIR/app" ]] || { echo "no server/app at $SERVER_DIR" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker not found — install Docker Desktop" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh CLI not found — brew install gh && gh auth login" >&2; exit 1; }

# ─── Test before shipping ───────────────────────────────────────────
# Same suite as the gateway's deploy — it's the one security review this
# image gets regardless of which role it's about to run as.
say "Running the server tests locally first"
if [[ -x "$SERVER_DIR/venv/bin/python" ]]; then
  (cd "$SERVER_DIR" && ./venv/bin/python -m pytest -q) || { echo "tests failed — not deploying" >&2; exit 1; }
  ok "suite green"
else
  printf '    \033[0;33m! no venv at server/venv — skipping local tests\033[0m\n'
fi

# ─── Bootstrap ──────────────────────────────────────────────────────
if [[ "$BOOTSTRAP" == true ]]; then
  say "Bootstrapping $VM_IP"
  $SSH 'sudo bash -s' < "$REPO_ROOT/infra/vm/bootstrap-worker.sh"
  ok "packages, docker, secrets, SSH hardening"

  say "Installing the systemd unit and release script"
  scp -q "$REPO_ROOT/infra/vm/foundry-worker@.service" "azureuser@$VM_IP:/tmp/"
  scp -q "$REPO_ROOT/infra/vm/foundry-worker-release.sh" "azureuser@$VM_IP:/tmp/"
  $SSH 'sudo install -m 644 "/tmp/foundry-worker@.service" /etc/systemd/system/ &&
        sudo install -m 755 /tmp/foundry-worker-release.sh /usr/local/sbin/foundry-worker-release &&
        sudo systemctl daemon-reload'
  ok "installed"
fi

# ─── Build and push ─────────────────────────────────────────────────
say "Building image"
docker build --platform linux/amd64 -t "$IMAGE" "$SERVER_DIR"
ok "built $IMAGE"

say "Pushing to GHCR"
gh auth token | docker login ghcr.io -u "$(gh api user --jq .login)" --password-stdin
docker push "$IMAGE"
ok "pushed"

# ─── Pull, restart, verify ──────────────────────────────────────────
# infra/vm/foundry-worker-release.sh is the one place this logic lives,
# same "CI and manual deploy call the same script" reasoning as the
# gateway's deploy.sh/foundry-release.sh pair.
say "Releasing on the VM"
if $SSH 'sudo /usr/local/sbin/foundry-worker-release'; then
  ok "worker instance(s) healthy on the VM"
else
  echo
  echo "  Deploy failed — see the logs above." >&2
  echo "  If this is the first deploy, confirm /etc/foundry/worker.env holds" >&2
  echo "  real values and at least one instance is enabled:" >&2
  echo "    ssh azureuser@$VM_IP" >&2
  echo "    sudo systemctl enable --now foundry-worker@1" >&2
  exit 1
fi

printf '\n\033[0;32mDeployed.\033[0m No public endpoint to check — verify with:\n  ssh azureuser@%s "sudo systemctl status foundry-worker@1"\n\n' "$VM_IP"
