-- ════════════════════════════════════════════════════════════════════
-- Foundry · One member's directory card, for "View profile" from a job's
-- "Posted by" row and from AI results (AI-plan §2, §12)
--
-- The same columns list_directory_cards returns for one member, so the
-- existing MemberDialog opens from anywhere. Approved members can already
-- read approved profiles (profiles RLS, and the dialog's own select), so
-- this widens nothing: it saves the client stitching a card together from
-- three queries. Committee members are included, as on /committee; a
-- member who isn't approved comes back empty.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.get_member_card(p_id uuid)
returns table (id uuid, first_name text, surname text, role user_role, course text, grad_year smallint,
               avatar_path text, bio_focus text, bio_hobbies text, created_at timestamptz,
               skill_names text[], sector_names text[])
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.first_name, p.surname, p.role, p.course, p.grad_year::smallint, p.avatar_path,
         left(coalesce(p.bio_focus, p.working_on), 160), left(p.bio_hobbies, 160), p.created_at,
         coalesce((select array_agg(s.name::text order by s.name)
                     from public.profile_skills ps join public.skills s on s.id = ps.skill_id
                    where ps.profile_id = p.id), array[]::text[]),
         coalesce((select array_agg(sc.name::text order by sc.name)
                     from public.profile_sectors psc join public.sectors sc on sc.id = psc.sector_id
                    where psc.profile_id = p.id), array[]::text[])
    from public.profiles p
   where p.id = p_id
     and p.status = 'approved'
     and (public.is_approved() or public.is_admin());
$$;

revoke all on function public.get_member_card(uuid) from public, anon, authenticated;
grant execute on function public.get_member_card(uuid) to authenticated;
