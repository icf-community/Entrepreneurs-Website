#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Manual database backup (launch programme B16)
#
# A full logical backup: roles, schema, and data (auth.* included, which
# is why the output is never committed: it carries live refresh tokens).
# Supabase Pro's daily backups are the primary copy; this is the extra,
# owner-held one, and the only one before a risky migration.
#
#   BACKUP_DB_URL='postgresql://…session pooler…' scripts/db-backup.sh
#
# Use the SESSION pooler string from the dashboard (Connect → Session
# pooler): the direct host is IPv6-only. The URL is read from the
# environment on purpose. This script never sources .env.local, which
# points at production.
#
# Writes backups/<UTC timestamp>/{roles,schema,data}.sql, mode 600.
# Restore rehearsal: scripts/db-restore-rehearsal.sh <that directory>.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

if [[ -z "${BACKUP_DB_URL:-}" ]]; then
  echo "BACKUP_DB_URL is not set. Pass the session-pooler connection string explicitly." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="backups/$stamp"
mkdir -p "$out"
chmod 700 backups "$out"
umask 077

echo "Dumping roles…";  supabase db dump --db-url "$BACKUP_DB_URL" --role-only -f "$out/roles.sql"
echo "Dumping schema…"; supabase db dump --db-url "$BACKUP_DB_URL"             -f "$out/schema.sql"
# Data for the two schemas the app owns. Files live in Azure Blob Storage,
# not Supabase Storage, and storage.* internals aren't restorable by the
# postgres role anyway.
echo "Dumping data…";   supabase db dump --db-url "$BACKUP_DB_URL" --data-only --use-copy --schema public,auth -f "$out/data.sql"

# A dump that silently came back empty is worse than a failed one.
for f in roles schema data; do
  if [[ ! -s "$out/$f.sql" ]]; then
    echo "ERROR: $out/$f.sql is empty." >&2
    exit 1
  fi
done
if ! grep -q '^COPY "public"\.' "$out/data.sql"; then
  echo "ERROR: $out/data.sql has no public-schema data at all." >&2
  exit 1
fi
# Tables the manual dump must cover (after-supabase-pro.md): the moderation
# record survives account deletion, so a restore must bring it back. The CLI
# leaves EMPTY tables out of a data-only dump, so absence is only a warning;
# profiles, though, is never empty on a real site.
grep -q '^COPY "public"\."profiles"' "$out/data.sql" || echo "WARNING: no rows for public.profiles." >&2
for t in post_moderation_log post_reports connections admin_actions; do
  grep -q "^COPY \"public\"\.\"$t\"" "$out/data.sql" || echo "note: public.$t has no rows in this dump."
done

echo "Backup written to $out ($(du -sh "$out" | cut -f1)). Keep it off shared drives; it contains auth tokens."
