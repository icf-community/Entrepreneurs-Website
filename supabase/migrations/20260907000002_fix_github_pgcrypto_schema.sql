-- ════════════════════════════════════════════════════════════════════
-- Foundry · Fix confirm_github_connected — pgp_sym_encrypt not on search_path
--
-- confirm_github_connected (20260907000001) pins `set search_path = public`
-- per this codebase's SECURITY DEFINER convention (prevents a search_path-
-- injection attack). But on this project pgcrypto is installed in the
-- `extensions` schema, not `public` (Supabase's default placement), so the
-- unqualified pgp_sym_encrypt(...) call failed at runtime with "function
-- pgp_sym_encrypt(text, text) does not exist" — caught during local-against-
-- prod testing of the GitHub connect flow, before any real token was ever
-- stored. Fix: schema-qualify the call instead of widening search_path, so
-- the security property of the pin is unchanged.
--
-- The worker's own pgp_sym_decrypt call (worker.py's direct psycopg
-- connection, not a SECURITY DEFINER function) is unaffected — that
-- connection's search_path already includes `extensions`.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.confirm_github_connected(
  p_github_user_id  bigint,
  p_github_username text,
  p_access_token    text,
  p_encryption_key  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.github_connections (
    member_id, github_user_id, github_username, access_token_encrypted,
    scan_status, scan_failure_reason, connected_at
  )
  values (
    v_caller, p_github_user_id, p_github_username,
    extensions.pgp_sym_encrypt(p_access_token, p_encryption_key),
    'pending', null, now()
  )
  on conflict (member_id) do update
    set github_user_id         = excluded.github_user_id,
        github_username        = excluded.github_username,
        access_token_encrypted = excluded.access_token_encrypted,
        scan_status            = 'pending',
        scan_failure_reason    = null,
        connected_at           = now();

  insert into public.jobs (kind, payload)
  values ('scan_github', jsonb_build_object('member_id', v_caller));
end;
$$;

revoke execute on function public.confirm_github_connected(bigint, text, text, text) from public, anon;
grant  execute on function public.confirm_github_connected(bigint, text, text, text) to authenticated;
