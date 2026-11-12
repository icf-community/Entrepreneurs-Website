-- Admin audit log retention: 6 years (Privacy Policy §8, 12 Nov 2026).
--
-- admin_actions was kept indefinitely, which storage limitation
-- (Art 5(1)(e) UK GDPR) does not allow without a reason. Six years is the
-- Limitation Act 1980 period for a contract or negligence claim, so it is
-- as long as an entry could be needed to explain a decision someone
-- challenges. docs/compliance/12-uk-legal-gap-analysis.md §3.5.
--
-- Same shape as purge_old_notifications (20260928000004): batched delete,
-- SECURITY DEFINER, callable only by the cron owner. No trigger or foreign
-- key depends on admin_actions rows, and created_at is indexed
-- (admin_actions_created_at_idx).

create or replace function public.purge_old_admin_actions()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.admin_actions
   where id in (
     select id from public.admin_actions
      where created_at < now() - interval '6 years'
      limit 5000
   );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.purge_old_admin_actions() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purge-old-admin-actions-daily');
exception when others then
  null;  -- not scheduled yet
end;
$$;

-- 02:55, after purge-sent-outbound-email at 02:50.
select cron.schedule(
  'purge-old-admin-actions-daily',
  '55 2 * * *',
  $$select public.purge_old_admin_actions();$$
);
