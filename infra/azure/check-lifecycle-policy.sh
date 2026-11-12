#!/usr/bin/env bash
# Drift check: the live blob management policy and soft-delete setting
# against what provision.sh commits to. Run after any deploy, and on a
# schedule — this is what would have caught the 2026-11 incident where the
# live policy applied a 30-day delete to profile-pictures/ and member-cvs/
# (both promised to be kept "until you replace, remove, or delete your
# account" — see frontend/src/app/privacy/page.tsx) weeks before anyone
# noticed broken avatars and CVs.
#
# Exits non-zero and prints exactly what's wrong on any drift. Read-only:
# makes no changes, just reads and compares.
set -euo pipefail

RG="${RG:-foundry-rg}"
SA="${SA:-}"
if [[ -z "$SA" ]]; then
  SA=$(az storage account list -g "$RG" --query "[0].name" -o tsv)
fi
if [[ -z "$SA" ]]; then
  echo "ERROR: no storage account found in resource group $RG" >&2
  exit 1
fi

FAIL=0
fail() { printf 'DRIFT: %s\n' "$*" >&2; FAIL=1; }
ok()   { printf 'OK: %s\n' "$*"; }

# ─── 1. Lifecycle policy: exactly one rule, scoped to post-images/ only ──
POLICY_JSON=$(az storage account management-policy show \
  --account-name "$SA" -g "$RG" -o json 2>/dev/null) || {
  fail "no management policy is set at all on $SA"
  POLICY_JSON='{"policy":{"rules":[]}}'
}

RULE_COUNT=$(jq '.policy.rules | length' <<<"$POLICY_JSON")
if [[ "$RULE_COUNT" != "1" ]]; then
  fail "expected exactly 1 lifecycle rule, found $RULE_COUNT"
else
  PREFIXES=$(jq -r '.policy.rules[0].definition.filters.prefixMatch | sort | join(",")' <<<"$POLICY_JSON")
  DAYS=$(jq -r '.policy.rules[0].definition.actions.baseBlob.delete.daysAfterModificationGreaterThan' <<<"$POLICY_JSON")
  ENABLED=$(jq -r '.policy.rules[0].enabled' <<<"$POLICY_JSON")

  if [[ "$PREFIXES" != "post-images/" ]]; then
    fail "lifecycle rule prefixMatch is [$PREFIXES], expected exactly [post-images/]." \
         " profile-pictures/ and member-cvs/ must never be in this rule — they have no fixed retention per the privacy page."
  else
    ok "lifecycle rule scoped to post-images/ only"
  fi

  if [[ "$ENABLED" != "true" ]]; then
    fail "lifecycle rule is disabled (orphaned post-image blobs will accumulate forever)"
  fi

  if [[ "$(printf '%.0f' "$DAYS")" != "30" ]]; then
    fail "lifecycle rule daysAfterModificationGreaterThan is $DAYS, expected 30"
  fi
fi

# ─── 2. Soft-delete / versioning must stay OFF (compliance-critical) ────
# See provision.sh step 3: ON means a member's "deleted" file is actually
# retained by Azure, contradicting the privacy page's deletion promise.
PROPS=$(az storage account blob-service-properties show \
  --account-name "$SA" -g "$RG" -o json)
BLOB_RETENTION=$(jq -r '.deleteRetentionPolicy.enabled' <<<"$PROPS")
CONTAINER_RETENTION=$(jq -r '.containerDeleteRetentionPolicy.enabled' <<<"$PROPS")
VERSIONING=$(jq -r '.isVersioningEnabled' <<<"$PROPS")

if [[ "$BLOB_RETENTION" == "true" || "$CONTAINER_RETENTION" == "true" || "$VERSIONING" == "true" ]]; then
  fail "soft-delete or versioning is ON (blob=$BLOB_RETENTION container=$CONTAINER_RETENTION versioning=$VERSIONING)." \
       " This must stay OFF — a member's deletion request has to actually delete the blob, not have Azure retain it."
else
  ok "soft-delete and versioning are off, as required"
fi

if [[ "$FAIL" != "0" ]]; then
  echo "" >&2
  echo "Live Azure storage config has drifted from infra/azure/provision.sh. Fix it with:" >&2
  echo "  az storage account management-policy update --account-name $SA -g $RG --set policy=@<corrected-policy.json>" >&2
  echo "or re-run the relevant section of infra/azure/provision.sh." >&2
  exit 1
fi

echo "Azure storage lifecycle/retention config matches provision.sh. No drift."
