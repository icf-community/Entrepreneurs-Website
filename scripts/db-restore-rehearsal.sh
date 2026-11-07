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
all_tables=$(grep -oE '^COPY "(public|auth)"\."[a-z_]+"' "$dir/data.sql" | sed 's/^COPY //' | sort -u)

# The app reads/writes only these auth.* tables; everything else in that
# schema (audit log, MFA, SCIM, SAML/SSO, custom OAuth clients, WebAuthn,
# instances) is GoTrue-internal plumbing the app never touches, is owned by
# a role "postgres" can't ALTER locally, and can be a newer shape on prod's
# hosted GoTrue than the pinned local CLI ships. Restoring those tables
# isn't needed to prove *this app's* data restores; they're reported, not
# loaded, and a non-empty one is noted rather than failed since it reflects
# normal GoTrue operation (e.g. every sign-in logs to audit_log_entries),
# not a gap in the backup.
auth_allow='"auth"."users" "auth"."identities" "auth"."sessions" "auth"."refresh_tokens" "auth"."flow_state" "auth"."one_time_tokens"'

skipped=""
load_tables=""
while IFS= read -r qt; do
  [[ -z "$qt" ]] && continue
  schema=$(sed -E 's/^"([a-z_]+)"\."([a-z_]+)"$/\1/' <<<"$qt")
  if [[ "$schema" == "auth" ]] && ! grep -qF "$qt" <<<"$auth_allow"; then
    skipped="${skipped:+$skipped }$qt"
    continue
  fi
  table=$(sed -E 's/^"([a-z_]+)"\."([a-z_]+)"$/\2/' <<<"$qt")
  exists=$("$PSQL" "$LOCAL_URL" -tA -c \
    "select 1 from information_schema.tables where table_schema='$schema' and table_name='$table'")
  if [[ "$exists" == "1" ]]; then
    load_tables="${load_tables:+$load_tables,}$qt"
  else
    # In-scope but genuinely missing locally (not expected) — a real gap.
    rows=$(awk -v t="COPY $qt " 'index($0,t)==1{f=1;next} f && /^\\\.$/{exit} f{n++} END{print n+0}' "$dir/data.sql")
    if [[ "$rows" -ne 0 ]]; then
      echo "ERROR: $qt has $rows row(s) in the dump but no matching table locally." >&2
      exit 1
    fi
    skipped="${skipped:+$skipped }$qt"
  fi
done <<<"$all_tables"

filtered="$dir/data.local-filtered.sql"
trap 'rm -f "$filtered"' EXIT
cp "$dir/data.sql" "$filtered"
for qt in $skipped; do
  rows=$(awk -v t="COPY $qt " 'index($0,t)==1{f=1;next} f && /^\\\.$/{exit} f{n++} END{print n+0}' "$dir/data.sql")
  echo "note: $qt out of rehearsal scope ($rows row(s) in dump, not loaded locally)." >&2
  awk -v t="COPY $qt " 'index($0,t)==1{f=1} f{if(/^\\\.$/)f=0; next} {print}' "$filtered" > "$filtered.tmp" && mv "$filtered.tmp" "$filtered"
done

# Within the in-scope tables, a column a newer hosted GoTrue added (e.g.
# one_time_tokens.expires_at) and the pinned local CLI lacks is only safe
# to drop from the load if every value for it in the dump is NULL —
# anything else is real data the local column would silently lose.
for qt in ${load_tables//,/ }; do
  schema=$(sed -E 's/^"([a-z_]+)"\."([a-z_]+)"$/\1/' <<<"$qt")
  table=$(sed -E 's/^"([a-z_]+)"\."([a-z_]+)"$/\2/' <<<"$qt")
  header=$(grep -m1 -F "COPY $qt (" "$filtered")
  dump_cols=$(sed -E 's/^COPY "[a-z_]+"\."[a-z_]+" \((.*)\) FROM stdin;$/\1/' <<<"$header" | tr -d '"' | tr ',' '\n' | sed 's/^ *//;s/ *$//')
  local_cols=$("$PSQL" "$LOCAL_URL" -tA -c \
    "select column_name from information_schema.columns where table_schema='$schema' and table_name='$table'")
  extra_idx=""
  i=0
  while IFS= read -r col; do
    i=$((i+1))
    [[ -z "$col" ]] && continue
    if ! grep -qxF "$col" <<<"$local_cols"; then
      nonnull=$(awk -v t="COPY $qt " -v i="$i" -F'\t' \
        'index($0,t)==1{f=1;next} f && /^\\\.$/{exit} f && $i!="\\N"{n++} END{print n+0}' "$filtered")
      if [[ "$nonnull" -ne 0 ]]; then
        echo "ERROR: $qt.$col has $nonnull non-null value(s) in the dump but no matching local column — real restore gap." >&2
        exit 1
      fi
      echo "note: $qt.$col not in the local auth schema (all NULL in dump, dropping column from load)." >&2
      extra_idx="${extra_idx:+$extra_idx,}$i"
    fi
  done <<<"$dump_cols"
  if [[ -n "$extra_idx" ]]; then
    keep_cols=""
    j=0
    while IFS= read -r col; do
      j=$((j+1))
      [[ -z "$col" ]] && continue
      case ",$extra_idx," in *",$j,"*) continue ;; esac
      keep_cols="${keep_cols:+$keep_cols, }\"$col\""
    done <<<"$dump_cols"
    keep_header="COPY $qt ($keep_cols) FROM stdin;"
    awk -v t="COPY $qt " -v drop="$extra_idx" -v newhdr="$keep_header" -F'\t' 'BEGIN{
        split(drop,d,","); for(k in d) dropset[d[k]]=1
      }
      index($0,t)==1{f=1; print newhdr; next}
      f && /^\\\.$/{f=0; print; next}
      f{
        out=""
        for(j=1;j<=NF;j++) if(!(j in dropset)) out=out (out==""?"":"\t") $j
        print out
        next
      }
      {print}
    ' "$filtered" > "$filtered.tmp" && mv "$filtered.tmp" "$filtered"
  fi
done

# replica mode skips triggers and FK checks while COPY loads tables in dump
# order, which is how Supabase documents restoring a data-only dump.
"$PSQL" "$LOCAL_URL" --single-transaction -v ON_ERROR_STOP=1 -q \
  -c "set session_replication_role = replica" \
  -c "truncate $load_tables cascade" \
  -f "$filtered"

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
