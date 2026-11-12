-- ════════════════════════════════════════════════════════════════════
-- Foundry · An open post report is never purged (D6)
--
-- The privacy page says: "A report that is still open when the 12 months
-- are up is kept until it is resolved, so that nothing is deleted out from
-- under an investigation." connection_reports' purge already skips open
-- rows (purge_connection_records); post_reports' did not, so an open post
-- report vanished at 12 months. Recreated from the live definition
-- (20260829000003) with only `and status <> 'open'` added. Same signature,
-- security and search_path; it stays internal (pg_cron only).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.purge_moderation_records()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer := 0;
  v_n     integer;
begin
  with doomed as (
    select id from public.post_moderation_log
     where purge_after < now() and legal_hold = false
     order by purge_after
     limit 5000
  ),
  deleted as (
    delete from public.post_moderation_log l
     using doomed d where l.id = d.id
    returning 1
  )
  select count(*) into v_n from deleted;
  v_count := v_count + v_n;

  with doomed as (
    select id from public.post_reports
     where purge_after < now()
       and status <> 'open'
     order by purge_after
     limit 5000
  ),
  deleted as (
    delete from public.post_reports r
     using doomed d where r.id = d.id
    returning 1
  )
  select count(*) into v_n from deleted;
  v_count := v_count + v_n;

  return v_count;
end;
$function$;

revoke execute on function public.purge_moderation_records() from public, anon, authenticated;
