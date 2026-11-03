-- ════════════════════════════════════════════════════════════════════
-- Foundry · A block survives the blocked person deleting and re-registering
--
-- Before: blocking is a `connections` row (status 'blocked'). Deleting the blocked
-- person's account cascades that row away, so they could sign up again with the same
-- address and contact the member who blocked them.
--
-- Now: when an account is deleted, every block it was the target of leaves a tombstone:
-- the blocker's id (so it vanishes if the blocker deletes theirs) and a one-way hash of
-- the deleted person's email, the same hash the ban tombstone uses. If that address
-- signs up again within 12 months the block is put back before they can do anything.
--
-- Deliberately NOT covered, by owner decision (2026-11-03): request cooldowns still reset
-- on deletion, and someone using a different email is a different person to this check.
--
-- Pre-check: none (new table, new triggers).
-- Deploy order: independent of the worker image and the web app.
-- Rollback: drop the two triggers, the two functions, the cron job and the table.
-- ════════════════════════════════════════════════════════════════════

create table public.block_tombstones (
  blocker_id         uuid not null references auth.users (id) on delete cascade,
  blocked_email_hash text not null,
  created_at         timestamptz not null default now(),
  primary key (blocker_id, blocked_email_hash)
);
create index block_tombstones_hash_idx on public.block_tombstones (blocked_email_hash);
alter table public.block_tombstones enable row level security;
revoke all on table public.block_tombstones from public, anon, authenticated;

-- BEFORE delete: the cascade has not removed the connections rows yet.
create or replace function public.tg_block_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.email is null then
    return old;
  end if;
  insert into public.block_tombstones (blocker_id, blocked_email_hash)
  select c.blocked_by, public.email_ban_hash(old.email)
    from public.connections c
   where c.status = 'blocked'
     and c.blocked_by <> old.id
     and old.id in (c.requester_id, c.addressee_id)
     and exists (select 1 from auth.users u where u.id = c.blocked_by)
  on conflict (blocker_id, blocked_email_hash) do update set created_at = now();
  return old;
end;
$$;
revoke all on function public.tg_block_tombstone() from public, anon, authenticated;

create trigger on_auth_user_deleted_block_tombstone
  before delete on auth.users
  for each row execute function public.tg_block_tombstone();

-- AFTER the profile exists (connections reference profiles), put every matching block back.
create or replace function public.tg_restore_blocks()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_hash text;
begin
  select public.email_ban_hash(u.email) into v_hash from auth.users u where u.id = new.id;
  if v_hash is null then
    return new;
  end if;
  insert into public.connections (requester_id, addressee_id, status, blocked_by, decided_at)
  select t.blocker_id, new.id, 'blocked', t.blocker_id, now()
    from public.block_tombstones t
    join public.profiles bp on bp.id = t.blocker_id
   where t.blocked_email_hash = v_hash
     and t.created_at > now() - interval '12 months'
     and t.blocker_id <> new.id
  on conflict do nothing;
  -- Consumed: the block row now carries the state. If the blocker lifts it and this person
  -- deletes again, no block exists to leave a new tombstone, so an old one must not revive it.
  delete from public.block_tombstones where blocked_email_hash = v_hash;
  return new;
end;
$$;
revoke all on function public.tg_restore_blocks() from public, anon, authenticated;

create trigger profiles_restore_blocks
  after insert on public.profiles
  for each row execute function public.tg_restore_blocks();

create or replace function public.purge_block_tombstones()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.block_tombstones where created_at < now() - interval '12 months';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_block_tombstones() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-block-tombstones-daily', '55 2 * * *', 'select public.purge_block_tombstones();');
  end if;
end $$;
