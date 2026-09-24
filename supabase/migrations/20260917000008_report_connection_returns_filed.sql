-- ════════════════════════════════════════════════════════════════════
-- Foundry · report_connection tells its caller whether it actually filed
--
-- A gap found while wiring the admin surface, and it is a compliance gap
-- rather than a cosmetic one.
--
-- report_post (20260830000001) returns `filed boolean` so the server
-- action can email the moderation inbox ON A GENUINELY NEW REPORT ONLY.
-- That notification exists because the Online Safety Act asks a
-- user-to-user service to act once it KNOWS about illegal content, and
-- knowing cannot depend on somebody remembering to open an admin page.
-- The optional 300-character note makes connections user-to-user content
-- too, so a connection report carries exactly the same duty — but
-- report_connection returned `void`, so the action had nothing to decide
-- on and no notification was ever sent.
--
-- WHY `filed` AND NOT "just always email". The RPC is idempotent through
-- the unique index: reporting twice succeeds silently, deliberately, so
-- nobody is told "you already reported this". Mailing on every call would
-- turn a double-click into a second notification and train whoever reads
-- that inbox to ignore it — which is the exact failure the notification
-- is here to prevent.
--
-- The return also carries the reported member's name and the category, so
-- the notification can be legible in a phone's notification list without
-- opening anything. It deliberately does NOT carry the note text: an
-- admin reads that behind a session, through the audited
-- admin_reveal_connection_note, not out of an inbox.
--
-- DROP first, not CREATE OR REPLACE: the return type changes from void to
-- a table, and CREATE OR REPLACE cannot do that. Dropping also drops the
-- grants, so they are restated at the bottom — the recurring
-- Supabase-default-privileges trap (20260608000001).
-- ════════════════════════════════════════════════════════════════════

drop function if exists public.report_connection(uuid, text, text);

create function public.report_connection(
  p_id       uuid,
  p_category text,
  p_reason   text
)
returns table (filed boolean, reported_name text, category text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
  v_other  uuid;
  v_count  int;
  v_filed  boolean;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can report' using errcode = '42501';
  end if;

  select * into v_row
    from public.connections c
   where c.id = p_id
     and (c.requester_id = v_caller or c.addressee_id = v_caller);

  if v_row.id is null then
    raise exception 'That request no longer exists.' using errcode = '22023';
  end if;

  v_other := case when v_row.requester_id = v_caller then v_row.addressee_id else v_row.requester_id end;

  -- Backstop against report-bombing aimed straight at the RPC. The
  -- unique index already stops repeat reports of the SAME connection;
  -- this is what stops one member working through everyone who has ever
  -- written to them. Mirrors the hardened report_post (20260830000001).
  select count(*) into v_count
    from public.connection_reports r
   where r.reporter_id = v_caller
     and r.created_at > now() - interval '24 hours';

  if v_count >= 10 then
    raise exception 'You''ve filed several reports recently. Please give us time to review them.'
      using errcode = '42501';
  end if;

  insert into public.connection_reports
    (connection_id, reporter_id, reported_member_id, category, reason, note_snapshot)
  values (p_id, v_caller, v_other, p_category, btrim(p_reason), v_row.note)
  on conflict do nothing;

  -- `found` after an INSERT is whether a row went in, and it is read
  -- IMMEDIATELY: the SELECT below would clobber it, which is the
  -- plpgsql trap this codebase has already been bitten by.
  v_filed := found;

  -- Logged whether or not the insert was a duplicate, so the silent
  -- idempotency above does not also silently swallow the audit trail.
  -- Note the event is 'reported', NOT 'report_upheld' — filing a report
  -- is not itself a reputation signal, or reporting would be a weapon.
  -- Only an admin upholding it writes the signal row.
  perform public.connection_log_event(p_id, v_caller, v_other, 'reported');

  return query
    select v_filed,
           trim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.surname, '')),
           p_category
      from public.profiles p
     where p.id = v_other;

  -- A member whose account vanished between the connection read and here
  -- leaves the join empty. The report is filed and committed regardless,
  -- so the caller gets a row saying so rather than nothing at all.
  if not found then
    return query select v_filed, ''::text, p_category;
  end if;
end;
$$;

revoke execute on function public.report_connection(uuid, text, text) from public, anon;
grant  execute on function public.report_connection(uuid, text, text) to authenticated;
