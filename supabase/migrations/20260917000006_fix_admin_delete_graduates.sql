-- ════════════════════════════════════════════════════════════════════
-- Foundry · Fix admin_delete_graduates: "column reference user_id is
--           ambiguous"
--
-- The function is `returns table(user_id uuid, email text, first_name
-- text)`, which makes `user_id` a PL/pgSQL OUT variable. Five statements
-- in the body then wrote `select user_id from _to_delete`, and Postgres
-- cannot tell the OUT variable from the temp table's own column:
--
--   ERROR:  column reference "user_id" is ambiguous
--   QUERY:  delete from public.opportunities
--           where posted_by in (select user_id from _to_delete)
--   CONTEXT: PL/pgSQL function admin_delete_graduates(integer) line 32
--
-- It has never been caught because the function returns early when the
-- cohort is empty, so it only fails when it is actually about to delete
-- somebody. Found while benchmarking the connections FK cascade — see
-- docs/audits/C3-connections-benchmark-gate.md, Finding 2.
--
-- The fix is a recreate-from-latest of 20260529000007's definition with
-- every `_to_delete` reference aliased (`td.user_id`), which is already
-- how the audit insert and the final `return query` were written. The
-- signature is byte-identical to the original so this replaces it rather
-- than creating a dead overload.
--
-- Also fixed here: the temp table is `on commit drop`, so a second call
-- inside the same transaction hit "relation _to_delete already exists".
-- A `drop table if exists` makes the function re-entrant within a
-- transaction, which is exactly how the SQL test harnesses call it.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_delete_graduates(
  p_cutoff_year int
)
returns table(user_id uuid, email text, first_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_count  int;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  if p_cutoff_year is null or p_cutoff_year < 1950 or p_cutoff_year > 2099 then
    raise exception 'Cutoff year must be between 1950 and 2099';
  end if;

  -- `on commit drop` only fires at commit, so a second call in the same
  -- transaction would otherwise collide with the first call's table.
  drop table if exists _to_delete;

  -- Materialise the set of doomed users so we can audit + email after
  -- the deletes finish.
  create temporary table _to_delete on commit drop as
    select p.id as user_id, au.email::text as email, p.first_name
      from public.profiles p
      join auth.users au on au.id = p.id
     where p.role = 'student'
       and p.status = 'approved'
       and p.grad_year is not null
       and p.grad_year <= p_cutoff_year;

  select count(*) into v_count from _to_delete;

  if v_count = 0 then
    return;
  end if;

  -- Clear blocking FKs for the entire cohort in one statement each.
  -- Every subselect is aliased: a bare `user_id` here is ambiguous
  -- against this function's OUT parameter of the same name.
  delete from public.opportunities where posted_by in (select td.user_id from _to_delete td);
  delete from public.events        where posted_by in (select td.user_id from _to_delete td);
  delete from public.vcs_grants    where posted_by in (select td.user_id from _to_delete td);
  delete from public.admin_actions where admin_id  in (select td.user_id from _to_delete td);

  -- Cascade-delete the auth rows themselves.
  delete from auth.users where id in (select td.user_id from _to_delete td);

  -- Audit: one row per deleted graduate.
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  select v_caller,
         'admin_delete_graduate',
         'auth.users',
         td.user_id,
         'Graduate cleanup, cutoff_year=' || p_cutoff_year
    from _to_delete td;

  return query
    select td.user_id, td.email, td.first_name from _to_delete td;
end;
$$;

revoke all     on function public.admin_delete_graduates(int) from public, anon;
grant  execute on function public.admin_delete_graduates(int) to authenticated;
