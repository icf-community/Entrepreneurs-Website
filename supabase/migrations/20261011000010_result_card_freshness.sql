-- S8 gap 19: result cards don't show source freshness. Recreated from the
-- latest definition (20261006000004); only the `extra` payload gains
-- `source_updated_at`, read from the same projection row the match itself
-- was scored against (ai_private.member_docs.updated_at /
-- ai_private.job_docs.updated_at), not a general "last edited" timestamp.
create or replace function public.ai_result_cards(p_turn uuid)
returns table (slot int, kind text, target_id uuid, title text, subtitle text, avatar_path text,
               score int, tier text, exact_tier int, coverage jsonb, components jsonb, evidence jsonb,
               stale boolean, change text, extra jsonb)
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_turn ai_private.turns;
  v_conv ai_private.conversations;
  v_prev uuid;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  select * into v_turn from ai_private.turns t
   where t.id = p_turn and t.owner_id = v_uid and t.expires_at > now() and t.status in ('completed', 'partial');
  if not found then
    return;
  end if;
  select * into v_conv from ai_private.conversations where id = v_turn.conversation_id;
  if v_turn.mode = 'recruiter' and not ai_private.recruiter_job_ok(v_uid, v_turn.opportunity_id) then
    return;
  end if;

  -- The previous completed turn in this conversation, for New/Updated.
  select t.id into v_prev from ai_private.turns t
   where t.conversation_id = v_turn.conversation_id and t.status in ('completed', 'partial')
     and t.created_at < v_turn.created_at and t.expires_at > now()
   order by t.created_at desc limit 1;

  if v_turn.mode in ('recruiter', 'network') then
    return query
      select r.slot, 'member'::text, r.target_member,
             trim(coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.surname),
             concat_ws(' · ', initcap(replace(p.role::text, '_', ' ')), p.course),
             p.avatar_path, r.score, r.tier, r.exact_tier,
             (select coalesce(jsonb_agg(c || jsonb_build_object(
                       'label', coalesce((select k.label from ai_private.concepts k where k.slug = c->>'concept'),
                                         c->>'free_text'))), '[]'::jsonb)
                from jsonb_array_elements(r.coverage) c),
             r.components,
             case when d.projection_hash is distinct from r.projection_hash then '[]'::jsonb else coalesce((
               select jsonb_agg(jsonb_build_object('text', left(e.text, 200), 'kind', e.source_kind,
                                                   'from_cv', e.from_cv))
                 from (select e2.* from ai_private.member_evidence e2
                        where e2.id = any(r.evidence_ids) and e2.member_id = r.target_member
                          and e2.purpose = v_turn.mode and e2.polarity = 'positive'
                          and (not e2.from_cv or (v_turn.mode = 'recruiter' and coalesce(ms.evidence_sharing, false)))
                        order by e2.id limit 2) e), '[]'::jsonb) end,
             d.projection_hash is distinct from r.projection_hash,
             case when v_prev is null then null
                  when not exists (select 1 from ai_private.results pr where pr.turn_id = v_prev
                                    and pr.target_member = r.target_member) then 'new'
                  when exists (select 1 from ai_private.results pr where pr.turn_id = v_prev
                                and pr.target_member = r.target_member
                                and pr.projection_hash is distinct from r.projection_hash) then 'updated'
                  else 'same' end,
             jsonb_build_object('source_updated_at', d.updated_at)
        from ai_private.results r
        join public.profiles p on p.id = r.target_member
        left join ai_private.member_docs d on d.member_id = r.target_member and d.purpose = v_turn.mode
        left join ai_private.member_settings ms on ms.member_id = r.target_member
       where r.turn_id = v_turn.id
         and ai_private.member_candidate_ok(v_uid, v_turn.mode, r.target_member, v_turn.opportunity_id, v_conv.spec)
       order by r.slot;
  else
    return query
      select r.slot, 'opportunity'::text, r.target_opportunity,
             o.position_name, o.company, null::text, r.score, r.tier, r.exact_tier,
             (select coalesce(jsonb_agg(c || jsonb_build_object(
                       'label', coalesce((select k.label from ai_private.concepts k where k.slug = c->>'concept'),
                                         c->>'free_text'))), '[]'::jsonb)
                from jsonb_array_elements(r.coverage) c),
             r.components, '[]'::jsonb,
             jd.content_version is distinct from (r.components->>'content_version')::int,
             case when v_prev is null then null
                  when not exists (select 1 from ai_private.results pr where pr.turn_id = v_prev
                                    and pr.target_opportunity = r.target_opportunity) then 'new'
                  else 'same' end,
             jsonb_build_object('deadline', o.application_deadline, 'location_type', o.location_type,
                                'location_text', o.location_text, 'pay', o.pay,
                                'apply_method', o.apply_method, 'apply_url', o.apply_url,
                                'contact_email', case when o.contact_email_visible then o.contact_email end,
                                'audience', o.eligible_audience,
                                'applied', exists (select 1 from public.user_listing_actions a
                                                    where a.user_id = v_uid and a.listing_kind = 'opportunity'
                                                      and a.listing_id = o.id and a.action_type = 'applied'),
                                'sparse', length(o.description) < 200,
                                'source_updated_at', jd.updated_at)
        from ai_private.results r
        join public.opportunities o on o.id = r.target_opportunity
        left join ai_private.job_docs jd on jd.opportunity_id = o.id
       where r.turn_id = v_turn.id and ai_private.job_candidate_ok(v_uid, r.target_opportunity)
       order by r.slot;
  end if;
end;
$$;

revoke all on function public.ai_result_cards(uuid) from public, anon, authenticated;
grant execute on function public.ai_result_cards(uuid) to authenticated;
