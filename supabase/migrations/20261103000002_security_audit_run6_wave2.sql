-- Security audit run-6 wave-2 (interrupted-session re-run):
-- 1. export_my_data distinguished decline (named 'closed') from a block by
--    the other member (row omitted) — an oracle during cooldown.
-- 2. Pending listing UPDATE could rewrite created_at without bumping
--    edit_version, so approval/home "newest" trusted a forged timestamp.
-- 3. Network AI eligibility hid blocks but still named declined members,
--    while connection_state_with presents both as unavailable.

-- ─── 1. export_my_data: other-party blocks are 'closed', like declines ─
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'format_version', 1,

    'account', (
      select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
        from auth.users u where u.id = v_me
    ),

    'profile', (
      select to_jsonb(p) - 'avatar_path' - 'cv_path' - 'cv_suggested_skill_ids'
        from public.profiles p where p.id = v_me
    ),

    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'is_core', ps.is_core) order by s.name)
        from public.profile_skills ps join public.skills s on s.id = ps.skill_id
       where ps.profile_id = v_me), '[]'::jsonb),

    'sectors', coalesce((
      select jsonb_agg(s.name order by s.name)
        from public.profile_sectors x join public.sectors s on s.id = x.sector_id
       where x.profile_id = v_me), '[]'::jsonb),

    'interests', coalesce((
      select jsonb_agg(jsonb_build_object('kind', i.kind, 'label', i.label, 'created_at', i.created_at) order by i.created_at)
        from public.profile_interests i where i.profile_id = v_me), '[]'::jsonb),

    'intents', coalesce((
      select jsonb_agg(jsonb_build_object('intent', i.intent, 'rank', i.rank) order by i.rank)
        from public.profile_intents i where i.profile_id = v_me), '[]'::jsonb),

    'email_changes', coalesce((
      select jsonb_agg(jsonb_build_object('old_email', e.old_email, 'new_email', e.new_email, 'changed_at', e.changed_at) order by e.changed_at)
        from public.email_change_log e where e.user_id = v_me), '[]'::jsonb),

    'listings', jsonb_build_object(
      'opportunities', coalesce((
        select jsonb_agg(to_jsonb(o) - 'approved_by' order by o.created_at)
          from public.opportunities o where o.posted_by = v_me), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(to_jsonb(e) - 'approved_by' order by e.created_at)
          from public.events e where e.posted_by = v_me), '[]'::jsonb),
      'vcs_grants', coalesce((
        select jsonb_agg(to_jsonb(v) - 'approved_by' order by v.created_at)
          from public.vcs_grants v where v.posted_by = v_me), '[]'::jsonb),
      'edits', coalesce((
        select jsonb_agg(to_jsonb(l) - 'reviewed_by' order by l.created_at)
          from public.listing_edits l where l.proposed_by = v_me), '[]'::jsonb)
    ),

    'bookmarks', coalesce((
      select jsonb_agg(jsonb_build_object('opportunity_id', b.opportunity_id, 'created_at', b.created_at) order by b.created_at)
        from public.opportunity_bookmarks b where b.user_id = v_me), '[]'::jsonb),

    'listing_actions', coalesce((
      select jsonb_agg(jsonb_build_object('listing_kind', a.listing_kind, 'listing_id', a.listing_id,
                                          'action', a.action_type, 'created_at', a.created_at) order by a.created_at)
        from public.user_listing_actions a where a.user_id = v_me), '[]'::jsonb),

    'listing_views', coalesce((
      select jsonb_agg(jsonb_build_object('listing_kind', e.listing_kind, 'listing_id', e.listing_id,
                                          'event', e.event_type, 'created_at', e.created_at) order by e.created_at)
        from public.listing_events e where e.viewer_id = v_me), '[]'::jsonb),

    'community', jsonb_build_object(
      'posts', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'title', p.title, 'body', p.body,
                                            'created_at', p.created_at, 'expires_at', p.expires_at) order by p.created_at)
          from public.posts p where p.author_id = v_me), '[]'::jsonb),
      'likes', coalesce((
        select jsonb_agg(jsonb_build_object('post_id', l.post_id, 'created_at', l.created_at) order by l.created_at)
          from public.post_likes l where l.user_id = v_me), '[]'::jsonb),
      'reports', coalesce((
        select jsonb_agg(jsonb_build_object('post_title', r.post_title_snapshot, 'category', r.category, 'reason', r.reason,
                                            'status', r.status, 'created_at', r.created_at, 'resolved_at', r.resolved_at)
                         order by r.created_at)
          from public.post_reports r where r.reporter_id = v_me), '[]'::jsonb)
    ),

    -- Other-party blocks used to be omitted while declines appeared as
    -- 'closed' — that split is an oracle during cooldown. Include every
    -- pair row; label other-party blocks 'closed' like declines.
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'member', public.notification_name(case when c.requester_id = v_me then c.addressee_id else c.requester_id end),
               'status', case
                           when c.status = 'accepted' then 'connected'
                           when c.status = 'pending' and c.requester_id = v_me then 'request sent'
                           when c.status = 'pending' then 'request received'
                           when c.status = 'blocked' and c.blocked_by = v_me then 'blocked by you'
                           else 'closed'
                         end,
               'note_you_wrote', case when c.requester_id = v_me then c.note end,
               'created_at', c.created_at) order by c.created_at)
        from public.connections c
       where c.requester_id = v_me or c.addressee_id = v_me), '[]'::jsonb),

    'connection_reports', coalesce((
      select jsonb_agg(jsonb_build_object('member', public.notification_name(r.reported_member_id), 'category', r.category,
                                          'reason', r.reason, 'status', r.status, 'created_at', r.created_at) order by r.created_at)
        from public.connection_reports r where r.reporter_id = v_me), '[]'::jsonb),

    'cvs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'original_filename', c.original_filename, 'mime_type', c.mime_type, 'status', c.status,
               'is_current', c.is_current, 'created_at', c.created_at, 'extracted_text', c.raw_text,
               'extracted_profile', (select cp.profile from public.cv_profiles cp where cp.cv_id = c.id and cp.is_current))
             order by c.created_at)
        from public.cvs c where c.member_id = v_me), '[]'::jsonb),

    'extracted_skills', coalesce((
      select jsonb_agg(jsonb_build_object('skill', k.canonical_name, 'source', m.source, 'as_written', m.raw_text) order by k.canonical_name)
        from public.member_skills m join public.cv_skills k on k.id = m.skill_id
       where m.member_id = v_me), '[]'::jsonb),

    'github', (
      select jsonb_build_object('username', g.github_username, 'connected_at', g.connected_at,
                                'last_scanned_at', g.last_scanned_at, 'scan_status', g.scan_status,
                                'signal', g.github_signal, 'showcase_repos', g.showcase_repos,
                                'showcase_nudges_enabled', g.showcase_nudges_enabled)
        from public.github_connections g where g.member_id = v_me
    ),

    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('kind', n.kind, 'title', n.title, 'body', n.body,
                                          'read_at', n.read_at, 'created_at', n.created_at) order by n.created_at)
        from public.notifications n where n.user_id = v_me), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.export_my_data() from public, anon, authenticated;
grant  execute on function public.export_my_data() to authenticated;

-- ─── 2. Lock listing created_at on UPDATE (pending PostgREST path) ───
create or replace function public.tg_listings_protect_created_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_at is distinct from old.created_at then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_opportunities_protect_created_at on public.opportunities;
create trigger trg_opportunities_protect_created_at
  before update on public.opportunities
  for each row execute function public.tg_listings_protect_created_at();

drop trigger if exists trg_events_protect_created_at on public.events;
create trigger trg_events_protect_created_at
  before update on public.events
  for each row execute function public.tg_listings_protect_created_at();

drop trigger if exists trg_vcs_grants_protect_created_at on public.vcs_grants;
create trigger trg_vcs_grants_protect_created_at
  before update on public.vcs_grants
  for each row execute function public.tg_listings_protect_created_at();

-- ─── 3. Network eligibility: decline cooldown == block for matching ──
create or replace function ai_private.connection_unavailable_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.connections c
     where least(c.requester_id, c.addressee_id) = least(p_a, p_b)
       and greatest(c.requester_id, c.addressee_id) = greatest(p_a, p_b)
       and (
         c.status = 'blocked'
         or c.status = 'pending'
         or (c.status in ('declined', 'withdrawn', 'removed')
             and c.cooldown_until is not null
             and c.cooldown_until > now())
       )
  );
$$;

revoke all on function ai_private.connection_unavailable_between(uuid, uuid) from public;

create or replace function ai_private.member_candidate_ok(p_owner uuid, p_mode text, p_target uuid,
                                                          p_opportunity uuid, p_spec jsonb)
returns boolean
language sql
stable
set search_path = ai_private, public
as $$
  select p_target <> p_owner
     and exists (select 1 from public.profiles p
                  where p.id = p_target and p.status = 'approved' and not p.is_committee
                    and (p_mode <> 'network' or p.open_to_connections))
     and exists (select 1 from ai_private.member_docs d
                  where d.member_id = p_target and d.purpose = p_mode)
     and not ai_private.blocked_between(p_owner, p_target)
     and (p_mode <> 'network' or not ai_private.connection_unavailable_between(p_owner, p_target))
     and (p_mode <> 'recruiter'
          or ai_private.member_in_audience(p_target, ai_private.recruiter_audience(p_opportunity, p_spec)));
$$;

revoke all on function ai_private.member_candidate_ok(uuid, text, uuid, uuid, jsonb) from public;
