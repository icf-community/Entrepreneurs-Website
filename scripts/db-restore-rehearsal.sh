#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Restore rehearsal into the LOCAL stack (launch programme B16)
#
# Proves a backup from scripts/db-backup.sh can actually be restored:
# resets the local database to the migrations (no seed), loads the dump's
# data, then runs the schema verification and prints row counts to compare
# with the source. Refuses anything but the local stack.
#
#   scripts/db-restore-rehearsal.sh backups/<timestamp>
#
# The prod restore test (into a throwaway Supabase project, from the Pro
# dashboard backups) is an owner step in the launch programme, E1a.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

dir="${1:?usage: $0 backups/<timestamp>}"
[[ -s "$dir/data.sql" ]] || { echo "No data.sql in $dir" >&2; exit 2; }

cd "$(dirname "$0")/.."
LOCAL_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
PSQL="${PSQL:-psql}"
command -v "$PSQL" >/dev/null || PSQL=/opt/homebrew/opt/libpq/bin/psql

echo "Resetting the LOCAL database to migrations only (no seed)…"
supabase db reset --local --no-seed

echo "Loading data…"
# Migrations seed some rows (app_config, the skills taxonomy, storage
# buckets) that the dump also carries, so every table the dump restores is
# emptied first; the dump then puts back exactly what the source had.
tables=$(grep -oE '^COPY "(public|auth)"\."[a-z_]+"' "$dir/data.sql" | sed 's/^COPY //' | paste -sd, -)
# replica mode skips triggers and FK checks while COPY loads tables in dump
# order, which is how Supabase documents restoring a data-only dump.
"$PSQL" "$LOCAL_URL" --single-transaction -v ON_ERROR_STOP=1 -q \
  -c "set session_replication_role = replica" \
  -c "truncate $tables cascade" \
  -f "$dir/data.sql"

echo "Verifying schema…"
"$PSQL" "$LOCAL_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/verify_prod_schema.sql >/dev/null

echo "Row counts after restore:"
"$PSQL" "$LOCAL_URL" -tA -c "
  select 'auth.users', count(*) from auth.users
  union all select 'profiles', count(*) from public.profiles
  union all select 'opportunities', count(*) from public.opportunities
  union all select 'events', count(*) from public.events
  union all select 'connections', count(*) from public.connections
  union all select 'posts', count(*) from public.posts
  union all select 'admin_actions', count(*) from public.admin_actions"
echo "Restore rehearsal passed. Compare these counts with the source database."
