-- ════════════════════════════════════════════════════════════════════
-- Foundry · Self-reported projects and experience (AI-plan §7.1, A1)
--
-- Members without a CV (most alumni, mentors, staff) need a way to supply
-- comparable evidence without being made to upload one or having LinkedIn
-- scraped. One short, owner-private note, labelled "self-reported"
-- wherever it is used, built into the projections under the same outbound
-- policy, consent and versioning as everything else. Changing it bumps
-- the member's source version like any other source.
--
-- set_my_ai_settings gains a parameter, so it is dropped and recreated
-- (F21) with its grants.
-- ════════════════════════════════════════════════════════════════════

alter table ai_private.member_settings
  add column self_reported text check (self_reported is null or length(self_reported) <= 1200);

drop function if exists public.get_my_ai_settings();
create function public.get_my_ai_settings()
returns table (recruiter_discoverable boolean, network_discoverable boolean, evidence_sharing boolean,
               use_chat_memory boolean, network_offers text[], network_seeks text[],
               pref_role_types text[], pref_location_types text[], consent_version text,
               updated_at timestamptz, self_reported text)
language sql
stable
security definer
set search_path = public, ai_private
as $$
  select coalesce(s.recruiter_discoverable, false), coalesce(s.network_discoverable, false),
         coalesce(s.evidence_sharing, false), coalesce(s.use_chat_memory, true),
         coalesce(s.network_offers, '{}'), coalesce(s.network_seeks, '{}'),
         coalesce(s.pref_role_types, '{}'), coalesce(s.pref_location_types, '{}'),
         s.consent_version, s.updated_at, s.self_reported
    from (select 1) one
    left join ai_private.member_settings s on s.member_id = (select auth.uid());
$$;
revoke all on function public.get_my_ai_settings() from public, anon, authenticated;
grant execute on function public.get_my_ai_settings() to authenticated;

drop function if exists public.set_my_ai_settings(boolean, boolean, boolean, boolean, text[], text[], text[], text[], text);
create function public.set_my_ai_settings(
  p_recruiter_discoverable boolean,
  p_network_discoverable   boolean,
  p_evidence_sharing       boolean,
  p_use_chat_memory        boolean,
  p_network_offers         text[],
  p_network_seeks          text[],
  p_pref_role_types        text[],
  p_pref_location_types    text[],
  p_consent_version        text,
  p_self_reported          text default null
)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_old  ai_private.member_settings;
  v_bump boolean;
  v_note text := nullif(btrim(coalesce(p_self_reported, '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_consent_version is null or length(p_consent_version) > 40 then
    raise exception 'Missing consent version' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1200 then
    raise exception 'Keep it under 1,200 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_network_offers, '{}') || coalesce(p_network_seeks, '{}')) s
              where not exists (select 1 from ai_private.concepts c where c.slug = s)) then
    raise exception 'Unknown topic' using errcode = '22023';
  end if;

  select * into v_old from ai_private.member_settings where member_id = v_uid for update;
  v_bump := v_old.member_id is null
         or v_old.recruiter_discoverable is distinct from p_recruiter_discoverable
         or v_old.network_discoverable   is distinct from p_network_discoverable
         or v_old.evidence_sharing       is distinct from p_evidence_sharing;

  insert into ai_private.member_settings as s (
    member_id, recruiter_discoverable, network_discoverable, evidence_sharing, use_chat_memory,
    network_offers, network_seeks, pref_role_types, pref_location_types, consent_version, consent_epoch,
    self_reported)
  values (v_uid, coalesce(p_recruiter_discoverable, false), coalesce(p_network_discoverable, false),
          coalesce(p_evidence_sharing, false), coalesce(p_use_chat_memory, true),
          coalesce(p_network_offers, '{}'), coalesce(p_network_seeks, '{}'),
          coalesce(p_pref_role_types, '{}'), coalesce(p_pref_location_types, '{}'),
          p_consent_version, 1, v_note)
  on conflict (member_id) do update
     set recruiter_discoverable = excluded.recruiter_discoverable,
         network_discoverable   = excluded.network_discoverable,
         evidence_sharing       = excluded.evidence_sharing,
         use_chat_memory        = excluded.use_chat_memory,
         network_offers         = excluded.network_offers,
         network_seeks          = excluded.network_seeks,
         pref_role_types        = excluded.pref_role_types,
         pref_location_types    = excluded.pref_location_types,
         consent_version        = excluded.consent_version,
         self_reported          = excluded.self_reported,
         consent_epoch          = s.consent_epoch + case when v_bump then 1 else 0 end,
         updated_at             = now();

  insert into ai_private.consent_events (member_id, choice, granted, consent_version)
  select v_uid, c.choice, c.granted, p_consent_version
    from (values ('recruiter_discoverable', coalesce(p_recruiter_discoverable, false), v_old.recruiter_discoverable),
                 ('network_discoverable',   coalesce(p_network_discoverable, false),   v_old.network_discoverable),
                 ('evidence_sharing',       coalesce(p_evidence_sharing, false),       v_old.evidence_sharing))
         as c(choice, granted, before)
   where c.before is distinct from c.granted;

  -- Withdrawal is immediate (§6).
  if not coalesce(p_recruiter_discoverable, false) then
    delete from ai_private.member_docs where member_id = v_uid and purpose = 'recruiter';
    delete from ai_private.member_evidence where member_id = v_uid and purpose = 'recruiter';
  end if;
  if not coalesce(p_network_discoverable, false) then
    delete from ai_private.member_docs where member_id = v_uid and purpose = 'network';
    delete from ai_private.member_evidence where member_id = v_uid and purpose = 'network';
  end if;

  perform ai_private.bump_member_source(v_uid);
end;
$$;
revoke all on function public.set_my_ai_settings(boolean, boolean, boolean, boolean, text[], text[], text[], text[], text, text) from public, anon, authenticated;
grant execute on function public.set_my_ai_settings(boolean, boolean, boolean, boolean, text[], text[], text[], text[], text, text) to authenticated;

-- The evidence kind, for the projection builder.
alter table ai_private.member_evidence drop constraint if exists member_evidence_source_kind_check;
alter table ai_private.member_evidence add constraint member_evidence_source_kind_check check (source_kind in (
  'skill_tag', 'sector_tag', 'interest', 'intent', 'offer', 'seek', 'bio_focus', 'bio_hobbies', 'course',
  'cv_skill', 'cv_project', 'cv_role', 'cv_education', 'github_language', 'github_repo', 'self_reported'));
