#!/usr/bin/env bash
#
# Foundry · Azure provisioning for the CV/GitHub ingestion worker VM
#
# Sibling to provision.sh, not an extension of it — the two VMs' resource
# needs barely overlap. This one creates: the VM (in the SAME resource
# group as the gateway, since it's the same project's infra), its managed
# identity, and ONE narrow RBAC grant (read-only, member-cvs container
# only — see below for why). It does NOT create a storage account, a
# Vercel service principal, a lifecycle policy, or any Cloudflare-facing
# NSG rule — none of that is this VM's concern. It has no public listener
# at all: no nginx, no inbound rule of any kind, not even the gateway's
# Cloudflare-443 rule.
#
# Why the worker needs blob access at all: server/app/worker.py:217 calls
# get_blob(cv_container, blob_key) via DefaultAzureCredential() — the same
# credential mechanism the gateway uses, which resolves to whichever VM's
# managed identity is running the process. The worker only ever READS a
# CV (never writes or deletes one — that's the gateway's job on upload/
# removal), so this grants Storage Blob Data Reader, not Contributor, and
# ONLY on member-cvs — the worker has no business touching post-images or
# profile-pictures.
#
# SAFE TO RE-RUN. Every step checks for what it is about to create.
#
#   ./provision-worker.sh                 provision, then print next steps
#   ./provision-worker.sh --print-only    just re-print values (creates nothing)
#
# Requires: az CLI, logged in to the RIGHT subscription, AND provision.sh
# already run (this script adopts the existing resource group + storage
# account rather than creating its own — it dies loudly if either is
# missing).
set -euo pipefail

# ─── Settings ───────────────────────────────────────────────────────
RG="${RG:-foundry-rg}"
LOC="${LOC:-uksouth}"
VM="${VM:-foundry-worker}"
CV_CONTAINER="${CV_CONTAINER:-member-cvs}"
# Same SKU as the gateway, for the same reason: every B-series option is
# still quota-blocked on this subscription in uksouth as of this script's
# writing (Standard Basv2/Bsv2/Bpsv2 Family vCPUs all show an approved
# limit of 0 — confirmed via `az vm list-usage`, not just the SKU
# availability list, which can look open while the actual quota is still
# zero). Standard DSv3 Family has 8 of 10 vCPUs still free after the
# gateway's 2, so this fits with real headroom to spare. Revisit if a
# Basv2 quota increase is ever approved — see provision.sh's identical note.
VM_SIZE="${VM_SIZE:-Standard_D2s_v3}"
SA="${SA:-}"

PRINT_ONLY=false
[[ "${1:-}" == "--print-only" ]] && PRINT_ONLY=true

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }
skip() { printf '    \033[0;90m·\033[0m %s\n' "$*"; }
die()  { printf '\n\033[0;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ─── Preflight ──────────────────────────────────────────────────────
command -v az >/dev/null || die "az CLI not found. brew install azure-cli"

ACCOUNT_JSON=$(az account show -o json 2>/dev/null) || die "Not logged in. Run: az login"
SUB_ID=$(jq -r .id   <<<"$ACCOUNT_JSON")
SUB_NAME=$(jq -r .name <<<"$ACCOUNT_JSON")

say "Subscription"
printf '    %s\n    %s\n' "$SUB_NAME" "$SUB_ID"
if [[ "$PRINT_ONLY" == false ]]; then
  read -rp $'\n    Provision into THIS subscription? [y/N] ' reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || die "Aborted. Switch with: az account set --subscription <id>"
fi

az group show -n "$RG" -o none 2>/dev/null || die "$RG does not exist. Run infra/azure/provision.sh first."

if [[ -z "$SA" ]]; then
  SA=$(az storage account list -g "$RG" --query "[0].name" -o tsv 2>/dev/null || true)
fi
[[ -n "$SA" && "$SA" != "None" ]] || die "No storage account found in $RG. Run infra/azure/provision.sh first."

CV_SCOPE="/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$SA/blobServices/default/containers/$CV_CONTAINER"

if [[ "$PRINT_ONLY" == true ]]; then
  say "Values (nothing created)"
  printf '    Storage account (adopted) = %s\n    CV container              = %s\n' "$SA" "$CV_CONTAINER"
  VM_STATE=$(az vm show -g "$RG" -n "$VM" -o none 2>/dev/null && echo "exists" || echo "not created")
  printf '    VM                        = %s\n' "$VM_STATE"
  exit 0
fi

# ─── 1. VM ──────────────────────────────────────────────────────────
say "Virtual machine"
if az vm show -g "$RG" -n "$VM" -o none 2>/dev/null; then
  skip "$VM already exists"
else
  # --nsg-rule NONE and nothing added afterward — this VM has no listener
  # at all, unlike the gateway which gets exactly one rule (Cloudflare
  # HTTPS only) in provision.sh. Nothing inbound is ever needed here.
  az vm create \
    -g "$RG" -n "$VM" -l "$LOC" \
    --image Ubuntu2404 \
    --size "$VM_SIZE" \
    --storage-sku os=StandardSSD_LRS \
    --admin-username azureuser \
    --generate-ssh-keys \
    --public-ip-sku Standard \
    --assign-identity \
    --nsg-rule NONE \
    -o none
  ok "created $VM ($VM_SIZE)"
fi

VM_IP=$(az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv)
ok "public IP $VM_IP (bootstrap-only access — see infra/vm/bootstrap-worker.sh; no standing inbound rule is ever added)"

# ─── 2. Managed identity → member-cvs, read-only ────────────────────
say "Managed identity RBAC"
PRINCIPAL=$(az vm identity show -g "$RG" -n "$VM" --query principalId -o tsv)
[[ -n "$PRINCIPAL" ]] || die "VM has no system-assigned identity."

# Confirmed live 2026-09-11: `--assignee <objectId>` alone can report this
# as missing even when the assignment is real (the same Graph-resolution
# quirk provision.sh's Delegator-role comment documents for the Vercel
# SP) — `az role assignment list --scope <scope>` filtered on principalId
# in the raw JSON is what actually reflects ground truth; the table
# view's "Principal" column shows principalName (the appId), not
# principalId, which looks like a mismatch but isn't one.
if az role assignment list --assignee "$PRINCIPAL" --scope "$CV_SCOPE" \
     --query "[?roleDefinitionName=='Storage Blob Data Reader']" -o tsv | grep -q .; then
  skip "already has Storage Blob Data Reader on $CV_CONTAINER"
else
  az role assignment create --assignee "$PRINCIPAL" \
    --role "Storage Blob Data Reader" --scope "$CV_SCOPE" -o none
  ok "$VM can read $CV_CONTAINER, and nowhere else"
fi

# ─── Done ───────────────────────────────────────────────────────────
cat <<EOF

╭──────────────────────────────────────────────────────────────────────╮
│  Provisioned. Next: bootstrap the VM (Tailscale, worker.env, systemd). │
╰──────────────────────────────────────────────────────────────────────╯

  VM public IP           $VM_IP
  ssh (bootstrap only)   ssh azureuser@$VM_IP

Next:
  1.  infra/vm/bootstrap-worker.sh, over SSH to $VM_IP — installs Docker,
      Tailscale, generates /etc/foundry/worker.env, drops in the systemd
      unit (infra/vm/foundry-worker@.service, already exists).
  2.  Join the tailnet (see production-runbook.md's Tailscale section —
      identical procedure, hostname foundry-worker), confirm SSH-over-
      Tailscale works, then delete the NSG's temporary access the same
      way — though unlike the gateway, this VM should never have had a
      standing port-22 rule to begin with.
  3.  Fill in /etc/foundry/worker.env's DATABASE_URL, OPENAI_API_KEY,
      GITHUB_TOKEN_ENCRYPTION_KEY by hand (same "never regenerated by a
      re-run" discipline as the gateway's secrets file).
  4.  systemctl enable --now foundry-worker@1 (instance count per the
      B2.8 load-test findings, not guessed).

EOF
