-- ════════════════════════════════════════════════════════════════════
-- Foundry · The outbound queue stops being a permanent archive
--
-- Found by the data-protection audit walking the ROPA against the code.
-- The ROPA describes `outbound_email` as "Transient · Drained every
-- 5 min", and item P says of a connection's email disclosure that
-- "there is no second copy of an address to have to erase".
--
-- Neither was true. `cron_drain_outbound_email` sets `sent_at` and
-- moves on; NOTHING ever deleted a sent row. The queue was transient
-- in intent and an append-only archive in fact, holding
-- `to_address`, `subject`, `text_body` and `html_body` for life.
--
-- That matters most for the one mail this feature added. The
-- connection-accept email tells the requester the address they just
-- earned, so its body IS a second copy of a released address — the
-- exact thing item P promised did not exist. Every other template is
-- addressed mail to a member we already hold an address for, which is
-- a smaller claim but the same unbounded window.
--
-- ─── WHY 7 DAYS FOR A SENT ROW ──────────────────────────────────────
-- A sent row has exactly one remaining job: answering "did that mail
-- actually go, and what did Resend call it?" when a member says they
-- never received something. That question arrives within days or not
-- at all. Seven days covers a member who reports on Monday something
-- that was sent the previous Tuesday, and nothing longer is doing
-- work.
--
-- It also leaves `admin_outbound_email_stats` intact, which was
-- checked rather than assumed: of its four numbers, three read only
-- UNSENT rows, and the fourth is `sent_at >= date_trunc('day', now())`
-- — today's sends, which a 7-day floor cannot reach.
--
-- ─── WHY BURIED ROWS GO TOO, AT 30 DAYS ─────────────────────────────
-- A row that exhausted `max_attempts` is never retried and never
-- deleted either, so the same defect exists on the failure path with
-- a different predicate. It is given longer because it is the one
-- diagnostic an admin might genuinely come back to — the `failed`
-- count on the admin queue badge is fed by these — but a delivery
-- failure nobody looked at in a month is not being looked at.
--
-- Rows still in flight (`sent_at is null` and `attempts < max_attempts`)
-- are never touched at any age. Deleting one would silently drop mail
-- somebody is waiting for.
--
-- ─── NO NEW INDEX ───────────────────────────────────────────────────
-- Deliberate. The queue is drained every five minutes and now purged
-- daily, so its steady-state size is days of traffic — hundreds of
-- rows against a Resend free tier of 100/day. A daily seq scan of
-- that is cheaper than the writes an extra index would cost on every
-- enqueue and every drain. Revisit if the sending volume ever makes
-- the table large enough to notice.
--
-- Bounded batch, same safety valve as the other purge jobs.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.purge_sent_outbound_email()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with doomed as (
    select id from public.outbound_email
     where (sent_at is not null and sent_at < now() - interval '7 days')
        or (sent_at is null
            and attempts >= max_attempts
            and created_at < now() - interval '30 days')
     order by created_at
     limit 2000
  ),
  gone as (
    delete from public.outbound_email e using doomed d where e.id = d.id returning 1
  )
  select count(*) into v_count from gone;

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public.purge_sent_outbound_email() from public, anon, authenticated;

-- 02:50, after the 02:45 connection purge. Nothing here depends on that
-- ordering; it just keeps the nightly retention jobs in one block.
do $$
begin
  begin perform cron.unschedule('purge-outbound-email-daily'); exception when others then null; end;
end;
$$;

select cron.schedule(
  'purge-outbound-email-daily',
  '50 2 * * *',
  $$select public.purge_sent_outbound_email();$$
);
