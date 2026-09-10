-- ════════════════════════════════════════════════════════════════════
-- Foundry · Surface github_signal.themes in the showcase picker
--
-- themes was computed by the scan and stored in github_connections.
-- github_signal from day one, but never threaded through to the
-- frontend — Part A's plan explicitly deferred "surfacing themes as
-- its own UI field" out of scope. Revisited after tightening the
-- combined-summary prompt (20260907000004's synthesize_combined_summary
-- now caps secondary-theme coverage in the prose to keep the summary
-- skimmable): the breadth that trims out of the paragraph belongs
-- somewhere the member can still see it, as compact tags rather than
-- sentences competing for the same few lines.
-- ════════════════════════════════════════════════════════════════════

-- Same recreate-from-latest shape as 20260907000004's own
-- get_my_github_status() recreation: DROP first because adding a
-- column to a `returns table` signature is not something CREATE OR
-- REPLACE can do in place.
drop function if exists public.get_my_github_showcase();

create or replace function public.get_my_github_showcase()
returns table (
  available_repos jsonb,
  showcase_repos  jsonb,
  suggested_repos jsonb,
  seen_repos      text[],
  themes          jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(gc.available_repos, '[]'::jsonb),
    gc.showcase_repos,
    coalesce(gc.github_signal->'top_repos', '[]'::jsonb),
    coalesce(gc.showcase_seen_repos, '{}'::text[]),
    coalesce(gc.github_signal->'themes', '[]'::jsonb)
  from public.github_connections gc
 where gc.member_id = auth.uid();
$$;

revoke execute on function public.get_my_github_showcase() from public, anon;
grant  execute on function public.get_my_github_showcase() to authenticated;
