-- ════════════════════════════════════════════════════════════════════
-- Foundry · Explicit anon revoke on the listing feeds (launch programme B12)
--
-- 20260917000018 recreated list_approved_opportunities / _events with a
-- grant to authenticated but no revoke. On a fresh build, the default
-- privileges set in 20260608000001 already keep anon out, but prod's ACLs
-- are whatever its history left them as, and a body guard is the only
-- thing that stopped anon today. Revoking explicitly makes the grant state
-- the same everywhere, matching 20260917000019's newest-listings feeds.
-- Idempotent: revoking a privilege that isn't held is a no-op.
-- ════════════════════════════════════════════════════════════════════

revoke execute on function public.list_approved_opportunities() from public, anon;
revoke execute on function public.list_approved_events()        from public, anon;
revoke execute on function public.list_approved_vcs_grants(text, text, date, date, integer, integer) from public, anon;

grant execute on function public.list_approved_opportunities() to authenticated;
grant execute on function public.list_approved_events()        to authenticated;
grant execute on function public.list_approved_vcs_grants(text, text, date, date, integer, integer) to authenticated;
