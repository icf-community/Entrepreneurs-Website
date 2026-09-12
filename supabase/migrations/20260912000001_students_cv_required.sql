-- ════════════════════════════════════════════════════════════════════
-- Foundry · a student's CV is required and cannot be removed to nothing
--
-- frontend/src/components/intake/screens.tsx already enforces this at
-- onboarding time (`const cvRequired = role === "student"` gates whether
-- the intake flow can be finished without one), but remove_my_cv() itself
-- has never checked role — any authenticated member, student or alum,
-- could call it and end up with no CV on file. That's a real gap, not
-- hypothetical: the RPC is the actual enforcement boundary, and a UI that
-- simply doesn't render a "Remove" button for students (this session's
-- ProfileForm.tsx change) is not itself enforcement — the client is never
-- trusted for a business rule the server can check directly.
--
-- Recreated whole from remove_my_cv()'s latest definition
-- (20260911000001_summary_lifecycle_fixes.sql), signature unchanged
-- ([[recreate-function-from-latest]]) — the only change is the new guard
-- immediately after the existing auth check.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.remove_my_cv()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_caller;
  if v_role = 'student' then
    raise exception 'CVs are required for students and cannot be removed — upload a replacement instead'
      using errcode = '42501';
  end if;

  perform set_config('foundry.media_write', 'true', true);
  update public.profiles
     set cv_path                 = null,
         cv_uploaded_at          = null,
         cv_original_filename    = null,
         cv_parse_consent        = false,
         cv_parse_consent_at     = null,
         cv_suggested_skill_ids  = null
   where id = v_caller;
  perform set_config('foundry.media_write', 'false', true);

  update public.cvs set is_current = false where member_id = v_caller and is_current;
  update public.cv_profiles cp
     set is_current = false
    from public.cvs c
   where c.id = cp.cv_id and c.member_id = v_caller and cp.is_current;
  update public.cv_chunks set is_current = false where member_id = v_caller and is_current;
  delete from public.member_skills where member_id = v_caller and source = 'cv';
end;
$$;

revoke execute on function public.remove_my_cv() from public, anon;
grant  execute on function public.remove_my_cv() to authenticated;
