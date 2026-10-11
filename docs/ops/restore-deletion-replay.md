# Restoring a backup without bringing deleted accounts back

A backup is a copy of the database at one moment. Restoring it brings back every account deleted
since then. Under UK GDPR, a member who deleted their account must stay deleted.

Every deletion leaves a tombstone in `public.deleted_accounts`: a SHA-256 of the user id and the
time, with no name or email. The trigger is on `auth.users`, so it covers every deletion path.
Tombstones are kept 35 days (longer than any backup or point-in-time window here), then purged daily.

## Steps (owner, during any restore)

1. **Before restoring**, export the tombstones from the live database:
   `\copy (select id_hash, deleted_at from public.deleted_accounts) to 'tombstones.csv' csv`
2. Restore the backup (Supabase dashboard, or `scripts/db-restore-rehearsal.sh` locally).
3. Load the tombstones back: `\copy public.deleted_accounts (id_hash, deleted_at) from 'tombstones.csv' csv`.
   A duplicate key on a row the backup already had is harmless; add `on conflict do nothing` via a
   temp table if your client stops on it.
4. Run `scripts/db-replay-deletions.sql`. It prints how many restored accounts it deleted again.
5. Check that `select count(*) from auth.users u join public.deleted_accounts d on d.id_hash =
   encode(extensions.digest(u.id::text, 'sha256'), 'hex')` returns 0.

## The limit

If the live database is lost entirely, step 1 can't happen, and deletions made after the restored
backup can't be replayed automatically. Reconcile them by hand from the deletion confirmations in
the appeals inbox. Point-in-time recovery (a Supabase add-on) narrows that window.

Covered by `supabase/tests/rls_smoke.sql` (S1 tombstones) and the local restore rehearsal.
