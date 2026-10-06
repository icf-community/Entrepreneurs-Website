#!/usr/bin/env bash
#
# Foundry · Azure provisioning for the AI executor (AI-plan §10, §10.1)
#
# OWNER-RUN. Nothing in the repo runs this; the AI build was written and
# tested against the fake provider locally.
#
# Creates, in the existing resource group:
#   * a Container Apps environment in UK South (no VNet, no ingress needed);
#   * a user-assigned identity with exactly one grant: "Key Vault Secrets
#     User" on ONE Key Vault (the image comes from GHCR; add a registry
#     pull secret if the package is private);
#   * that Key Vault, holding the executor's only three secrets:
#       ai-database-url     ai_service DSN through the session pooler,
#                           ?sslmode=require (never the postgres DSN)
#       ai-openai-api-key   the MATCHING project's key, never ingestion's
#       sentry-dsn          optional
#   * the container app: one warm replica (min 1, max 1; F5), no ingress,
#     no Blob, GitHub, VM or subscription permissions.
#
# It does NOT set the secret values, confirm model prices, create the
# OpenAI project or turn any AI flag on. Those are separate owner steps,
# listed at the end.
#
# SAFE TO RE-RUN. Every step checks for what it is about to create.
#
#   ./provision-ai.sh                 provision, then print next steps
#   ./provision-ai.sh --print-only    just print the next steps
#
# Requires: az CLI with the containerapp extension, logged in to the RIGHT
# subscription, and provision.sh already run (same resource group).
set -euo pipefail

RG="${RG:-foundry-rg}"
LOC="${LOC:-uksouth}"
ENV_NAME="${ENV_NAME:-foundry-ai-env}"
APP="${APP:-foundry-ai}"
IDENTITY="${IDENTITY:-foundry-ai-id}"
KV="${KV:-foundry-ai-kv}"
IMAGE="${IMAGE:-ghcr.io/icf-community/foundry-ai:latest}"
CPU="${CPU:-0.5}"
MEMORY="${MEMORY:-1.0Gi}"

PRINT_ONLY=false
[[ "${1:-}" == "--print-only" ]] && PRINT_ONLY=true

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }
skip() { printf '    \033[0;90m·\033[0m %s\n' "$*"; }
die()  { printf '\n\033[0;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

next_steps() {
  cat <<EOF

Next steps (owner):
  1. Set the three secrets:
       az keyvault secret set --vault-name $KV --name ai-database-url   --value 'postgresql://ai_service.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=require'
       az keyvault secret set --vault-name $KV --name ai-openai-api-key --value '<matching project key>'
       az keyvault secret set --vault-name $KV --name sentry-dsn        --value '<dsn or a single space>'
     The ai_service password is set in the SQL editor: alter role ai_service password '<generated>';
  2. Confirm model prices against OpenAI's pricing page, then in the SQL editor:
       update ai_private.model_prices set input_micro_per_mtok = ..., output_micro_per_mtok = ...,
              price_version = price_version + 1, confirmed = true where model in ('gpt-5.4', 'gpt-5.4-mini', 'text-embedding-3-small');
     The executor refuses to start until every model it uses is confirmed.
  3. Make yourself an AI operator (after you are an admin):
       insert into ai_private.operators (member_id) select id from auth.users where email = '<you>';
  4. Set the GitHub environment variable AZURE_AI_APP_NAME=$APP, then run the "Deploy AI executor" workflow.
  5. Watch the Sentry cron monitor 'ai-executor' check in, then switch modes on in /admin/ai, one at a time.
EOF
}

if $PRINT_ONLY; then next_steps; exit 0; fi

command -v az >/dev/null || die "az CLI not found. brew install azure-cli"
az account show >/dev/null 2>&1 || die "Not logged in. az login"
az group show -n "$RG" >/dev/null 2>&1 || die "Resource group $RG not found — run provision.sh first."
az extension add --name containerapp --upgrade --only-show-errors >/dev/null

say "Key Vault"
if az keyvault show -n "$KV" -g "$RG" >/dev/null 2>&1; then skip "$KV exists"; else
  az keyvault create -n "$KV" -g "$RG" -l "$LOC" --enable-rbac-authorization true --only-show-errors >/dev/null
  ok "created $KV (RBAC authorisation)"
fi
KV_ID=$(az keyvault show -n "$KV" -g "$RG" --query id -o tsv)

say "Identity"
if az identity show -n "$IDENTITY" -g "$RG" >/dev/null 2>&1; then skip "$IDENTITY exists"; else
  az identity create -n "$IDENTITY" -g "$RG" -l "$LOC" --only-show-errors >/dev/null
  ok "created $IDENTITY"
fi
ID_ID=$(az identity show -n "$IDENTITY" -g "$RG" --query id -o tsv)
ID_PRINCIPAL=$(az identity show -n "$IDENTITY" -g "$RG" --query principalId -o tsv)

say "Grant: Key Vault Secrets User on $KV only"
if az role assignment list --assignee "$ID_PRINCIPAL" --scope "$KV_ID" --query "[?roleDefinitionName=='Key Vault Secrets User']" -o tsv | grep -q .; then
  skip "already granted"
else
  az role assignment create --assignee-object-id "$ID_PRINCIPAL" --assignee-principal-type ServicePrincipal \
    --role "Key Vault Secrets User" --scope "$KV_ID" --only-show-errors >/dev/null
  ok "granted"
fi

say "Container Apps environment"
if az containerapp env show -n "$ENV_NAME" -g "$RG" >/dev/null 2>&1; then skip "$ENV_NAME exists"; else
  az containerapp env create -n "$ENV_NAME" -g "$RG" -l "$LOC" --only-show-errors >/dev/null
  ok "created $ENV_NAME in $LOC"
fi

say "Container app (one warm replica, no ingress)"
KV_URI=$(az keyvault show -n "$KV" -g "$RG" --query properties.vaultUri -o tsv)
if az containerapp show -n "$APP" -g "$RG" >/dev/null 2>&1; then skip "$APP exists (deploy-ai.yml updates its image)"; else
  az containerapp create -n "$APP" -g "$RG" --environment "$ENV_NAME" \
    --image "$IMAGE" --cpu "$CPU" --memory "$MEMORY" \
    --min-replicas 1 --max-replicas 1 \
    --user-assigned "$ID_ID" \
    --secrets "ai-database-url=keyvaultref:${KV_URI}secrets/ai-database-url,identityref:${ID_ID}" \
              "ai-openai-api-key=keyvaultref:${KV_URI}secrets/ai-openai-api-key,identityref:${ID_ID}" \
              "sentry-dsn=keyvaultref:${KV_URI}secrets/sentry-dsn,identityref:${ID_ID}" \
    --env-vars "AI_DATABASE_URL=secretref:ai-database-url" "AI_OPENAI_API_KEY=secretref:ai-openai-api-key" \
               "SENTRY_DSN=secretref:sentry-dsn" "SENTRY_ENVIRONMENT=production" "AI_PROVIDER=openai" "AI_WORKERS=4" \
    --only-show-errors >/dev/null
  ok "created $APP"
fi

next_steps
