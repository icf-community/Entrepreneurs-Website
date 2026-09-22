-- ════════════════════════════════════════════════════════════════════
-- Foundry · list_my_blocked_members
--
-- A gap found while building the UI, not a new feature: `block_member`
-- and `unblock_member` both shipped in 20260917000002, and
-- `connection_state_with` reports `blocked_by_me` — but there was no way
-- to ENUMERATE who you have blocked. The only route to unblocking
-- somebody was finding them again in a directory of thousands, which is
-- exactly the search a blocker should not have to perform.
--
-- Scoped to rows the caller BLOCKED, never rows where they were blocked.
-- A member must not be able to learn that they have been blocked — that
-- is the same guarantee every refusal message in this feature is written
-- to preserve — so `blocked_by = caller` is the whole of the predicate
-- and there is no counterpart RPC.
--
-- No email address, deliberately. Blocking removes any connection, so
-- there is no consent left standing to disclose one under.
--
-- No paging: the cap on this list is the number of people one member has
-- personally blocked. A member with more than a screenful of those has a
-- problem the admin queue should already be looking at, and a LIMIT here
-- would only hide it.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.list_my_blocked_members()
returns table (
  member_id   uuid,
  first_name  text,
  surname     text,
  role        public.user_role,
  course      text,
  grad_year   smallint,
  avatar_path text,
  blocked_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or not (public.is_approved() or public.is_admin()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.first_name,
      p.surname,
      p.role,
      p.course,
      p.grad_year::smallint,
      p.avatar_path,
      c.decided_at
    from public.connections c
    join public.profiles p
      on p.id = case when c.requester_id = v_caller then c.addressee_id else c.requester_id end
   where c.status = 'blocked'
     and c.blocked_by = v_caller
     and (c.requester_id = v_caller or c.addressee_id = v_caller)
   -- A blocked member whose account was since deleted is gone from
   -- `profiles` and the join drops them, which is correct: the block row
   -- goes with them on the FK cascade anyway.
   order by c.decided_at desc nulls last, p.id desc;
end;
$$;

revoke execute on function public.list_my_blocked_members() from public, anon;
grant  execute on function public.list_my_blocked_members() to authenticated;
