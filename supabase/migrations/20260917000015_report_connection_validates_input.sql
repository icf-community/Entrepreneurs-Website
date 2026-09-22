-- ════════════════════════════════════════════════════════════════════
-- Foundry · report_connection validates its own input
--
-- Found by driving the real UI and then calling the RPC directly, which
-- is the threat model: the report dialog offers a fixed <select>, so the
-- only way to send an invalid category is to skip the UI entirely.
--
-- WHAT WENT WRONG. `category` and `reason` were checked only by the
-- table's CHECK constraints, so an invalid value came back as a raw
-- Postgres 23514 — and PostgREST puts the whole failing row in the
-- error's `details`. That row includes `note_snapshot`, the private
-- member-to-member note this feature works hard to keep behind an
-- audited admin reveal. Verified against a live stack:
--
--   report_connection(<id>, 'not-a-category', 'probing...')
--   → {"code":"23514","details":"Failing row contains (98c7bcaa-…,
--      …, not-a-category, probing…, SECRET-NOTE-TEXT-should-not-leak…"}
--
-- HOW BAD IT ACTUALLY WAS: not a disclosure, and that was luck of
-- ordering rather than design. The party check above the insert already
-- rejects a non-party with a clean 'That request no longer exists.'
-- (also verified), so the only person who could ever provoke the dump is
-- someone who is party to that connection — who either wrote the note or
-- had it shown to them in their own requests list. Nothing leaked that
-- the caller was not already entitled to.
--
-- WHY FIX IT ANYWAY. Because the safety is entirely positional. It rests
-- on the party check staying above the insert, and on no future column
-- of this table holding something a party is not entitled to. Neither is
-- written down anywhere the next person editing this function would see.
-- And it was the single uncurated error in the whole feature: every
-- other refusal here returns a sentence written for a human, while this
-- one returned the schema.
--
-- `reason` gets the same treatment for the same reason — the dialog
-- enforces 10 characters, so an empty or 5,000-character reason is
-- likewise only reachable by skipping it.
--
-- CREATE OR REPLACE, not DROP: the signature and return type are
-- unchanged from 20260917000008, so replacing keeps the grants. They are
-- restated at the bottom regardless — `revoke ... from public` is a
-- no-op on Supabase and this repo has been bitten by assuming otherwise
-- (20260608000001).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.report_connection(
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
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can report' using errcode = '42501';
  end if;

  -- Both checks are BEFORE the row is read, so an invalid category can
  -- never reach the insert and never provoke a failing-row dump. The
  -- list is the table's CHECK constraint restated; if one changes the
  -- other has to, and the rls_smoke assertion holds them together.
  if p_category is null or p_category not in
       ('harassment', 'spam', 'impersonation', 'illegal', 'hate', 'sexual', 'other') then
    raise exception 'Choose a reason from the list.' using errcode = '22023';
  end if;

  if length(v_reason) < 1 or length(v_reason) > 1000 then
    raise exception 'Tell us what happened, in 1000 characters or fewer.' using errcode = '22023';
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
  values (p_id, v_caller, v_other, p_category, v_reason, v_row.note)
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
