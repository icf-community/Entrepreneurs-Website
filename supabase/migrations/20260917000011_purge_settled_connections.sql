-- ════════════════════════════════════════════════════════════════════
-- Foundry · Settled connection rows are deleted, not kept forever
--
-- Found by the data-protection audit walking the ROPA against the code.
-- Three documents said a request's note is "cleared when the request is
-- answered or expires" and that a request "expires after six months".
-- Neither was true: `purge_removed_connections()` deleted only
-- `status = 'removed'`, `expire_connection_requests()` only flips
-- pending → expired, and nothing ever deleted a `declined`, `withdrawn`
-- or `expired` row. A declined request's note text and its
-- who-asked-whom record therefore persisted INDEFINITELY — removed only
-- by account deletion or by the pair being reused for a later request.
--
-- The documents were right about the intent and the code was wrong, so
-- the code moves. Keeping a member's unanswered approach on file for
-- life is not something this feature ever needed, and it is not
-- something anyone was told.
--
-- ─── WHY EACH STATUS IS TREATED AS IT IS ────────────────────────────
--
-- declined / withdrawn — deleted once `cooldown_until` lapses, exactly
--   like `removed`. Deleting one EARLIER would destroy the cooldown
--   itself, since the cooldown is enforced by reading this row; the
--   `cooldown_until <= now()` predicate is load-bearing, not tidiness.
--
-- expired — deleted on sight. Expiry deliberately carries no cooldown
--   (nobody decided anything; the request was ignored, possibly because
--   the recipient never logged in), so the pair is already re-sendable
--   immediately. Deleting the row IS that state, expressed once instead
--   of twice.
--
-- blocked — NEVER deleted here. A block is permanent until the blocker
--   lifts it, and the row is the block.
--
-- accepted / pending — live state, obviously untouched.
--
-- ─── WHAT IS NOT LOST ───────────────────────────────────────────────
-- The reputation signal. Blocks and upheld reports live in
-- `connection_events`, which carries NO foreign key to this table and
-- survives on its own 12-month clock, so deleting a settled connection
-- cannot launder a throttle. A report keeps its own `note_snapshot`
-- taken at report time, for the same reason.
--
-- Bounded batch, same safety valve as the other purge jobs: at today's
-- membership the limit never engages, but it stops a long-paused cron
-- from deleting an enormous backlog in one statement while holding
-- locks.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.purge_removed_connections()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with doomed as (
    select id from public.connections
     where (
             -- Settled by somebody, and the cooldown that row was
             -- keeping has run out.
             status in ('removed', 'declined', 'withdrawn')
             and cooldown_until is not null
             and cooldown_until <= now()
           )
        or (
             -- Settled by the clock. No cooldown was ever set, so there
             -- is nothing left for the row to enforce.
             status = 'expired'
           )
     order by coalesce(cooldown_until, decided_at)
     limit 500
  ),
  gone as (
    delete from public.connections c using doomed d where c.id = d.id returning 1
  )
  select count(*) into v_count from gone;

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public.purge_removed_connections() from public, anon, authenticated;
