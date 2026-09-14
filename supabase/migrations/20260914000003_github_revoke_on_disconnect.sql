-- ════════════════════════════════════════════════════════════════════
-- Foundry · Revoke the GitHub OAuth grant when a connection is deleted
--
-- disconnect_github() and every account-deletion path (delete_my_account,
-- admin_delete_user, admin_delete_graduates, and the plain cascade from
-- deleting auth.users) already destroy our copy of the encrypted token.
-- That was never the gap: once our row is gone, we hold nothing usable.
-- The gap was that GitHub's own authorization grant stayed live on the
-- member's account until they went and revoked it themselves by hand.
--
-- Same shape as tg_enqueue_profile_media_deletion (20260901000002): a
-- trigger on the row being deleted, not a line added to each of the four
-- call sites, so every deletion path is covered uniformly and a future
-- fifth one gets it for free. AFTER DELETE fires on a cascade exactly
-- the same as a direct DELETE (confirmed — this is the same mechanism
-- the blob-deletion trigger on profiles already relies on for
-- delete_my_account/admin_delete_user).
--
-- Why a job, not an RPC a frontend could call directly: revoking needs
-- the *decrypted* token, and this schema has deliberately never exposed
-- that over PostgREST to any authenticated caller — only the worker,
-- which already holds GITHUB_TOKEN_ENCRYPTION_KEY and a direct database
-- connection, ever sees a token in plaintext. Adding a "decrypt and
-- hand it back" RPC would be a real increase in attack surface (a
-- compromised session could pull a live token, not just trigger scoped
-- actions with it) for a nice-to-have cleanup feature — not a trade
-- worth making. The encrypted bytes travel through the job queue
-- exactly as encrypted as they were in the table; only the worker's
-- decrypt step ever sees plaintext, same as every scan job already
-- works.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.tg_enqueue_github_revocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.access_token_encrypted is not null then
    insert into public.jobs (kind, payload)
    values (
      'revoke_github_token',
      jsonb_build_object(
        'access_token_encrypted_hex', encode(old.access_token_encrypted, 'hex'),
        'github_user_id', old.github_user_id
      )
    );
  end if;
  return old;
end;
$$;

drop trigger if exists github_connections_enqueue_revocation on public.github_connections;
create trigger github_connections_enqueue_revocation
  after delete on public.github_connections
  for each row
  execute function public.tg_enqueue_github_revocation();

revoke execute on function public.tg_enqueue_github_revocation() from public, anon, authenticated;
