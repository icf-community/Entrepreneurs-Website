-- Security audit follow-up (run-2, 2026-10-26). Three independently
-- verified findings fixed in one migration.
--
-- 1. 🟠 MEDIUM — profiles_update_own (20260527000002) checks only
--    `id = auth.uid()`, with no status/role/column restriction, and the
--    table-level UPDATE grant on public.profiles was never revoked for
--    `authenticated` (20260901000009's own comment confirms this was
--    deliberate — "profiles_update_own ... rely on those table-level
--    grants existing"). Every legitimate self-edit path (update_profile,
--    set_my_linkedin, submit_onboarding, etc.) is a SECURITY DEFINER RPC
--    and runs as the function owner, entirely unaffected by this grant —
--    grep confirms no frontend code calls
--    `supabase.from('profiles').update(...)` directly. So the grant has
--    no legitimate user and is pure attack surface: any approved member
--    can `PATCH /rest/v1/profiles?id=eq.<own_uid>` with `is_committee`,
--    `committee_role`, or (for a banned member with a still-live listing)
--    their own displayed name/LinkedIn, bypassing every RPC-level check
--    added across prior fixes (20261025000001's lifecycle trigger guards
--    is_committee/committee_role specifically, but a table-level UPDATE
--    privilege lets the request reach the trigger at all — the real gap
--    is that direct writes should never reach profiles this way to begin
--    with).
--
--    Fix: revoke the table-level UPDATE grant outright and drop the now-
--    dead policy. role/status already have their own protect triggers,
--    which stay (defence in depth for the (unlikely) day a future
--    migration re-grants UPDATE); the committee/lifecycle trigger from
--    20261025000001 stays for the same reason.
revoke update on public.profiles from authenticated, anon;
drop policy if exists profiles_update_own on public.profiles;

-- 2. 🟠 MEDIUM — named_person's `like` pattern (ai_submit_turn) is built
--    from a member-writable profile name with no escaping. A member who
--    sets first_name/surname to '%' (via a legitimate RPC — the pattern
--    check itself has no format rule) turns the pattern into `'%% %%'`,
--    which LIKE-matches any message containing a space, so every other
--    member's `kind = 'message'` turn is refused with 'named_person'
--    platform-wide until an admin edits the row. Fix: `strpos(...) > 0`
--    is a literal substring search with no wildcard semantics at all, so
--    '%' (or any other LIKE metacharacter) in a stored name is inert.
--    Recreated from 20261026000001 (true latest), only this one clause
--    changed.
CREATE OR REPLACE FUNCTION public.ai_submit_turn(p_mode text, p_conversation uuid, p_opportunity uuid, p_kind text, p_message text, p_idempotency_key text, p_expected_revision integer, p_temporary boolean DEFAULT false)
 RETURNS TABLE(turn_id uuid, conversation_id uuid, outcome text, retry_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'ai_private'
AS $$
declare
  v_uid       uuid := auth.uid();
  v_conv      ai_private.conversations;
  v_cfg       ai_private.settings;
  v_msg       text;
  v_digest    text;
  v_existing  ai_private.turns;
  v_count     int;
  v_oldest    timestamptz;
  v_surfaced  int;
  v_msg_id    uuid;
  v_turn      uuid;
  v_estimate  bigint;
  v_spent     bigint;
  v_member    bigint;
  v_day       date := (now() at time zone 'utc')::date;
  v_tomorrow  timestamptz := ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
  v_unconfirmed boolean;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_mode not in ('recruiter', 'network', 'opportunities') or p_kind not in ('message', 'run', 'confirm', 'rescan') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Cheap checks first; nothing below writes until every check passes.
  v_msg := nullif(btrim(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]', ' ', 'g')), '');
  if p_kind = 'message' and (v_msg is null or char_length(v_msg) > 600) then
    perform ai_private.record_admission_refusal('invalid_message');
    return query select null::uuid, p_conversation, 'invalid_message'::text, null::timestamptz;
    return;
  end if;
  if p_kind <> 'message' then
    v_msg := null;
  end if;

  -- One admission at a time per member, held to commit: concurrent tabs
  -- or retries cannot each see the same counts and all pass the per-member
  -- limits, and a repeated idempotency key finds the first turn instead of
  -- racing it to the unique constraint.
  perform pg_advisory_xact_lock(hashtext('ai_submit_member'), hashtext(v_uid::text));

  v_digest := encode(sha256(convert_to(concat_ws('|', p_mode, p_conversation, p_opportunity, p_kind, v_msg,
                                                 p_expected_revision, p_temporary), 'utf8')), 'hex');
  select * into v_existing from ai_private.turns t where t.owner_id = v_uid and t.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.body_digest = v_digest then
      return query select v_existing.id, v_existing.conversation_id, 'duplicate'::text, null::timestamptz;
    else
      perform ai_private.record_admission_refusal('idempotency_conflict');
      return query select null::uuid, p_conversation, 'idempotency_conflict'::text, null::timestamptz;
    end if;
    return;
  end if;

  if not public.ai_mode_enabled(p_mode) then
    perform ai_private.record_admission_refusal('disabled');
    return query select null::uuid, p_conversation, 'disabled'::text, null::timestamptz;
    return;
  end if;

  if p_mode = 'recruiter' then
    if p_opportunity is null or not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
      perform ai_private.record_admission_refusal('job_not_eligible');
      return query select null::uuid, p_conversation, 'job_not_eligible'::text, null::timestamptz;
      return;
    end if;
    if not exists (select 1 from ai_private.job_requirements r join public.opportunities o on o.id = r.opportunity_id
                    where r.opportunity_id = p_opportunity and r.status = 'confirmed'
                      and r.content_version = o.content_version) then
      perform ai_private.record_admission_refusal('requirements_unconfirmed');
      return query select null::uuid, p_conversation, 'requirements_unconfirmed'::text, null::timestamptz;
      return;
    end if;
  elsif p_opportunity is not null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Conversation: existing (owner, mode and job must match; compare-and-
  -- swap on the spec revision) or a new one.
  if p_conversation is not null then
    select * into v_conv from ai_private.conversations c
     where c.id = p_conversation and c.owner_id = v_uid for update;
    if not found or v_conv.mode <> p_mode or v_conv.opportunity_id is distinct from p_opportunity then
      perform ai_private.record_admission_refusal('not_found');
      return query select null::uuid, p_conversation, 'not_found'::text, null::timestamptz;
      return;
    end if;
    if v_conv.spec_revision <> coalesce(p_expected_revision, -1) then
      perform ai_private.record_admission_refusal('stale_revision');
      return query select null::uuid, p_conversation, 'stale_revision'::text, null::timestamptz;
      return;
    end if;
    if (select count(*) from ai_private.turns t where t.conversation_id = v_conv.id and t.expires_at > now()
          and t.status in ('completed', 'partial', 'refused', 'clarify', 'failed', 'queued', 'running')) >= 15 then
      perform ai_private.record_admission_refusal('thread_full');
      return query select null::uuid, v_conv.id, 'thread_full'::text, null::timestamptz;
      return;
    end if;
    if p_kind = 'confirm' and v_conv.pending_ops is null then
      perform ai_private.record_admission_refusal('nothing_to_confirm');
      return query select null::uuid, v_conv.id, 'nothing_to_confirm'::text, null::timestamptz;
      return;
    end if;
  else
    if p_kind not in ('message') then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    if (select count(*) from ai_private.conversations c
         where c.owner_id = v_uid
           and exists (select 1 from ai_private.messages m where m.conversation_id = c.id and m.expires_at > now())) >= 5 then
      perform ai_private.record_admission_refusal('too_many_threads');
      return query select null::uuid, null::uuid, 'too_many_threads'::text, null::timestamptz;
      return;
    end if;
  end if;

  -- Concurrency: one running turn per conversation, two per member.
  if p_conversation is not null and exists (select 1 from ai_private.turns t
                where t.conversation_id = p_conversation and t.status in ('queued', 'running')) then
    perform ai_private.record_admission_refusal('busy');
    return query select null::uuid, p_conversation, 'busy'::text, null::timestamptz;
    return;
  end if;
  if (select count(*) from ai_private.turns t where t.owner_id = v_uid and t.status in ('queued', 'running')) >= 2 then
    perform ai_private.record_admission_refusal('busy');
    return query select null::uuid, p_conversation, 'busy'::text, null::timestamptz;
    return;
  end if;

  -- Rates: 5 a minute, 40 a rolling day, shared by every mode (§9).
  select count(*), min(u.created_at) into v_count, v_oldest
    from ai_private.usage_events u where u.owner_id = v_uid and u.created_at > now() - interval '1 minute';
  if v_count >= 5 then
    perform ai_private.record_admission_refusal('rate_minute');
    return query select null::uuid, p_conversation, 'rate_minute'::text, v_oldest + interval '1 minute';
    return;
  end if;
  select count(*), min(u.created_at) into v_count, v_oldest
    from ai_private.usage_events u where u.owner_id = v_uid and u.created_at > now() - interval '24 hours';
  if v_count >= 40 then
    perform ai_private.record_admission_refusal('rate_day');
    return query select null::uuid, p_conversation, 'rate_day'::text, v_oldest + interval '24 hours';
    return;
  end if;

  -- Rescans (§8.1): five-minute cooldown, ten a day per job.
  if p_kind = 'rescan' then
    if p_mode <> 'recruiter' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    select count(*), max(u.created_at) into v_count, v_oldest
      from ai_private.usage_events u
     where u.owner_id = v_uid and u.kind = 'rescan:' || p_opportunity::text
       and u.created_at > now() - interval '24 hours';
    if v_oldest is not null and v_oldest > now() - interval '5 minutes' then
      perform ai_private.record_admission_refusal('rescan_cooldown');
      return query select null::uuid, p_conversation, 'rescan_cooldown'::text, v_oldest + interval '5 minutes';
      return;
    end if;
    if v_count >= 10 then
      perform ai_private.record_admission_refusal('rescan_limit');
      return query select null::uuid, p_conversation, 'rescan_limit'::text, now() + interval '24 hours';
      return;
    end if;
  end if;

  -- Distinct members surfaced, checked before any money is reserved (F7).
  if p_mode in ('recruiter', 'network') then
    select count(*) into v_surfaced
      from ai_private.surfaced_members sm
     where sm.owner_id = v_uid and sm.surfaced_at > now() - interval '24 hours';
    -- Each in-flight recruiter/network turn may still surface up to 10
    -- members; a member may have two in flight, and checking only this
    -- turn's 10 let the pair pass at 135 and publish 20 (R1).
    select count(*) into v_count
      from ai_private.turns t
     where t.owner_id = v_uid and t.status in ('queued', 'running') and t.mode in ('recruiter', 'network');
    if v_surfaced + 10 * (v_count + 1) > 150 then
      perform ai_private.record_admission_refusal('surface_limit');
      return query select null::uuid, p_conversation, 'surface_limit'::text, now() + interval '24 hours';
      return;
    end if;
  end if;

  -- Queue bound (§9): refuse before any provider call, keep the draft.
  -- Serialised across members from here to commit, so a burst can't all
  -- read the same queue length; the lock is held only for the few
  -- milliseconds left in this transaction.
  perform pg_advisory_xact_lock(hashtext('ai_submit_queue'));
  select * into v_cfg from ai_private.settings where id = 1;
  if (select count(*) from ai_private.turns t where t.status = 'queued') >= v_cfg.queue_capacity then
    perform ai_private.record_admission_refusal('queue_full');
    return query select null::uuid, p_conversation, 'queue_full'::text, now() + interval '1 minute';
    return;
  end if;

  -- Budget headroom for this turn's worst case: interpreter + four
  -- assessors + one embedding, at current prices. Reservations happen
  -- per call in the executor; this only refuses a turn that cannot fit.
  select count(*) < 3 or bool_or(not mp.confirmed),
         coalesce(sum(case mp.model
                        when 'gpt-5.4-mini' then (6000 * mp.input_micro_per_mtok + 1500 * mp.output_micro_per_mtok)
                        when 'gpt-6.1-sol' then 4 * (12000 * mp.input_micro_per_mtok + 3000 * mp.output_micro_per_mtok)
                        when 'text-embedding-3-small' then 2000 * mp.input_micro_per_mtok
                      end), 0) / 1000000
    into v_unconfirmed, v_estimate
    from ai_private.model_prices mp
   where mp.model in ('gpt-5.4-mini', 'gpt-6.1-sol', 'text-embedding-3-small');
  if v_unconfirmed then
    perform ai_private.record_admission_refusal('price_unconfirmed');
    return query select null::uuid, p_conversation, 'price_unconfirmed'::text, null::timestamptz;
    return;
  end if;
  select coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching'), 0),
         coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching' and s.member_id = v_uid), 0)
    into v_spent, v_member
    from ai_private.spend s where s.day = v_day;
  if v_spent + v_estimate > v_cfg.matching_daily_cap_micro or v_member + v_estimate > v_cfg.member_daily_cap_micro then
    perform ai_private.record_admission_refusal('budget_exhausted');
    return query select null::uuid, p_conversation, 'budget_exhausted'::text, v_tomorrow;
    return;
  end if;

  -- No names as search criteria (§1): a member's full name in the
  -- message is refused, and the text is not stored. strpos, not LIKE: a
  -- stored first_name/surname containing '%' (or '_') is only a literal
  -- character here, never a wildcard — closes the named_person LIKE
  -- injection (audit follow-up, run-2).
  if v_msg is not null and exists (
       select 1 from public.profiles p
        where p.status = 'approved' and length(p.first_name) > 1 and length(p.surname) > 1
          and strpos(lower(v_msg), lower(p.first_name || ' ' || p.surname)) > 0) then
    perform ai_private.record_admission_refusal('named_person');
    return query select null::uuid, p_conversation, 'named_person'::text, null::timestamptz;
    return;
  end if;

  -- Admitted.
  if p_conversation is null then
    insert into ai_private.conversations (owner_id, mode, opportunity_id, temporary, title, spec)
    values (v_uid, p_mode, p_opportunity, coalesce(p_temporary, false),
            left(ai_private.redact_contact(v_msg), 60),
            case when p_mode = 'recruiter'
                 then (select jsonb_build_object('schema_version', 1, 'next_id', 100,
                                                 'atoms', coalesce(r.confirmed, '[]'::jsonb))
                         from ai_private.job_requirements r where r.opportunity_id = p_opportunity)
                 else '{"schema_version": 1, "atoms": [], "next_id": 1}'::jsonb end)
    returning * into v_conv;
  end if;

  if v_msg is not null then
    insert into ai_private.messages (conversation_id, owner_id, role, kind, body)
    values (v_conv.id, v_uid, 'member', 'message', left(ai_private.redact_contact(v_msg), 700))
    returning id into v_msg_id;
  end if;

  insert into ai_private.turns (conversation_id, owner_id, mode, opportunity_id, kind, message_id,
                                idempotency_key, body_digest, expected_revision, stage)
  values (v_conv.id, v_uid, p_mode, p_opportunity, p_kind, v_msg_id, p_idempotency_key, v_digest,
          v_conv.spec_revision, 'queued')
  returning id into v_turn;

  update ai_private.messages set turn_id = v_turn where id = v_msg_id;
  update ai_private.conversations set last_activity_at = now() where id = v_conv.id;
  insert into ai_private.usage_events (owner_id, mode, kind)
  values (v_uid, p_mode, case when p_kind = 'rescan' then 'rescan:' || p_opportunity::text else p_kind end);

  return query select v_turn, v_conv.id, 'queued'::text, null::timestamptz;
end;
$$;

revoke all on function public.ai_submit_turn(text, uuid, uuid, text, text, text, int, boolean) from public, anon, authenticated;
grant execute on function public.ai_submit_turn(text, uuid, uuid, text, text, text, int, boolean) to authenticated;

-- 3. 🟢 LOW — list_my_bookmarked_opportunities has no is_approved()/
--    is_admin() gate on the CALLER, unlike its sibling
--    list_approved_opportunities. Its existing WHERE already restricts by
--    the opportunity's target *audience* (member_admits_audience, added
--    20261006000002) — but that function only reads member_education
--    (currently_enrolled / has_completed_degree), never profiles.status,
--    so a pending or banned account whose education fields happen to
--    match an audience still passes it. Combined with
--    opportunity_bookmarks_insert_own (which only checks
--    `user_id = auth.uid()`, no approval check), such an account can
--    bookmark a known opportunity UUID and read the full listing +
--    poster name/LinkedIn/avatar through this RPC — data every other
--    approved-members-only surface correctly withholds from them.
--    Recreated from 20261006000002 (true latest — the 23-column,
--    audience-aware definition, not 20260530000005's original 21-column
--    shape), adding one AND clause; everything else byte-identical. The
--    insert policy gets the matching check so a non-approved account
--    can't even create the bookmark row that makes the RPC worth calling.
drop function if exists public.list_my_bookmarked_opportunities();
create function public.list_my_bookmarked_opportunities()
returns table(id uuid, position_name text, company text, pay text, location_type location_type,
              location_text text, description text, start_month smallint, start_year integer,
              application_deadline date, contact_email text, contact_email_visible boolean,
              apply_method apply_method, apply_url text, posted_by uuid,
              created_at timestamp with time zone, poster_first_name text, poster_surname text,
              poster_linkedin_url text, skill_names text[], sector_names text[],
              bookmarked_at timestamp with time zone, eligible_audience text, poster_avatar_path text)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select
    o.id, o.position_name, o.company, o.pay,
    o.location_type, o.location_text,
    o.description, o.start_month, o.start_year,
    o.application_deadline,
    case
      when o.contact_email_visible
        or o.posted_by = (select auth.uid())
        or public.is_admin()
      then o.contact_email
      else null
    end,
    o.contact_email_visible,
    o.apply_method, o.apply_url,
    o.posted_by, o.created_at,
    p.first_name, p.surname, p.linkedin_url,
    coalesce((
      select array_agg(s.name order by s.name)
      from public.opportunity_skills os
      join public.skills s on s.id = os.skill_id
      where os.opportunity_id = o.id
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(s.name order by s.name)
      from public.opportunity_sectors os
      join public.sectors s on s.id = os.sector_id
      where os.opportunity_id = o.id
    ), ARRAY[]::text[]),
    b.created_at,
    o.eligible_audience,
    p.avatar_path
  from public.opportunity_bookmarks b
  join public.opportunities o on o.id = b.opportunity_id
  left join public.profiles p on p.id = o.posted_by
  where b.user_id = (select auth.uid())
    and (public.is_approved() or public.is_admin())
    and o.status = 'approved'
    and o.application_deadline >= current_date
    and (public.is_admin() or o.posted_by = (select auth.uid())
         or public.member_admits_audience((select auth.uid()), o.eligible_audience))
  order by b.created_at desc;
$function$;
revoke all on function public.list_my_bookmarked_opportunities() from public, anon, authenticated;
grant execute on function public.list_my_bookmarked_opportunities() to authenticated;

drop policy if exists opportunity_bookmarks_insert_own on public.opportunity_bookmarks;
create policy opportunity_bookmarks_insert_own
  on public.opportunity_bookmarks for insert
  to authenticated
  with check (user_id = (select auth.uid()) and (public.is_approved() or public.is_admin()));
