-- ════════════════════════════════════════════════════════════════════
-- Foundry · Seed a 2000-member corpus for the scalability audit (C2)
--
-- NEVER RUN THIS AGAINST PRODUCTION. It is a measurement fixture: 2000
-- fake accounts, ~10k CV chunks and ~20k analytics rows, all of it
-- indistinguishable from real data once it is in the table. There is no
-- "undo" that is not `reset_to_admin_only.sql`.
--
-- Run against a LOCAL `supabase start` stack (or a throwaway project):
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/snippets/seed_scale_corpus.sql
--
-- ──────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
-- ──────────────────────────────────────────────────────────────────────
-- Every RLS policy and every list RPC in this database has only ever been
-- executed against ~30 rows. A policy that runs a correlated subquery per
-- row is invisible at 30 and fatal at 2000, and no amount of reading the
-- SQL tells you which one you have — the planner decides, and it decides
-- differently once the statistics change. This seeds the row counts that
-- make `explain (analyze, buffers)` mean something.
--
-- Volumes are chosen to match the audit's stated population (2000
-- members, ~1000 of whom connect GitHub), not to be maximal:
--
--   profiles            2000    listing_events      20000
--   profile_skills     ~12000   posts                1500
--   profile_sectors     ~4000   post_likes          ~8000
--   events               300    cvs                  1200
--   opportunities        400    cv_profiles          1200
--   vcs_grants           150    cv_chunks          ~10000
--   github_connections   800    member_skills      ~12000
--
-- EMBEDDINGS are the expensive part and the reason cv_chunks is capped at
-- ~10000: vector(1536) is 6,144 bytes on the wire before page overhead,
-- so 10k chunks is ~60 MB and 20k is ~120 MB. They are generated from a
-- pool of 64 random base vectors with per-row jitter rather than 10000
-- independent random draws — 15M random() calls is minutes of CPU for no
-- benefit, because what is being measured is the cost of *scanning* the
-- column (there is no ANN index; 20260906000001:95 defers it deliberately),
-- and a sequential scan reads every row whatever is in it.
--
-- IDEMPOTENT: re-running deletes the previous corpus first, keyed on the
-- @scale.invalid email domain, so it can never touch a real account.
-- ════════════════════════════════════════════════════════════════════

\timing on

do $$
declare
  -- ── Knobs. Lower N_MEMBERS for a quick smoke run. ──────────────────
  --
  -- N_MEMBERS was 2000 for the original C2 audit (2026-09-08) and is
  -- 5000 from the Connections benchmark gate (2026-09-17) onward. 5000
  -- is 2.5x expected membership, and the connections edge generator at
  -- the bottom of this file targets 2.5x expected density on top of it,
  -- so a plan that holds here holds with a lot of room to spare.
  --
  -- The earlier 2000-member numbers are a recorded historical result,
  -- not something regenerated from this file, so nothing is invalidated
  -- by the bump — but do not compare a 5000-member timing against them.
  n_members  constant int := 5000;
  n_events   constant int := 300;
  n_opps     constant int := 400;
  n_vcs      constant int := 150;
  n_posts    constant int := 1500;
  n_lev      constant int := 20000;
  n_cvs      constant int := 1200;
  n_chunks   constant int := 10000;
  n_github   constant int := 800;

  v_admin    uuid;
  v_n        int;
begin
  -- Trigger-guarded columns (status, role, avatar_path/cv_path) and the
  -- admin RPCs all read auth.role(). psql carries no JWT, so claim
  -- service_role for the transaction. Transaction-local.
  perform set_config('request.jwt.claims',
    json_build_object('role','service_role')::text, true);

  -- ── Refuse to run anywhere that looks like production ──────────────
  -- The corpus is unmistakable once seeded and there is no clean removal
  -- from a database with real accounts in it. Two independent checks:
  -- the local stack's well-known superuser password is not a secret, and
  -- a real deployment has accounts this script did not create.
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'ABORT: unexpected server version';
  end if;
  --
  -- Two gates, and BOTH must be open before a foreign account is
  -- tolerated. `supabase start` ships a hard-coded development JWT
  -- secret; a real project's is generated and secret, so that literal
  -- string is proof of a throwaway stack and cannot be forged from
  -- outside it. It is not sufficient on its own — it says "this is
  -- local", not "this is empty" — so the domain check still governs
  -- every database that is not demonstrably the dev stack.
  --
  -- Why this is needed at all: a local stack legitimately holds ONE
  -- real-looking address — the single admin account that
  -- reset_to_admin_only.sql leaves behind — and the domain check alone
  -- refuses to seed there, which is the one place seeding is correct.
  if not (
    current_setting('app.settings.jwt_secret', true)
      = 'super-secret-jwt-token-with-at-least-32-characters-long'
  ) and exists (
    select 1 from auth.users
     where email not like '%scale.invalid%'
       and email not like '%e2e-%'
       and email not like '%@imperial.ac.uk'
  ) then
    raise exception
      'ABORT: this database contains accounts outside the test domains — refusing to seed';
  end if;

  -- ── Clean any previous corpus, in the FK order that actually works ──
  -- (see reset_to_admin_only.sql's header: posted_by is RESTRICT, so
  -- listings must precede the accounts that posted them.)
  --
  -- The key is '%scale.invalid%', NOT '%@scale.invalid'. Step 2 rewrites
  -- the 1200 student accounts to <name>.scale.invalid@imperial.ac.uk so
  -- they satisfy is_imperial_email, and the trailing-domain form misses
  -- every one of them — which is exactly what happened: a re-run cleaned
  -- 800 of 2000 rows and then died on users_email_partial_key when it
  -- tried to rename students that already existed. The marker is a
  -- substring precisely so it survives that rewrite; match it that way.
  delete from public.listing_events le
   where le.viewer_id in (select id from auth.users where email like '%scale.invalid%');
  delete from public.events e
   where e.posted_by in (select id from auth.users where email like '%scale.invalid%');
  delete from public.opportunities o
   where o.posted_by in (select id from auth.users where email like '%scale.invalid%');
  delete from public.vcs_grants v
   where v.posted_by in (select id from auth.users where email like '%scale.invalid%');
  delete from public.admin_actions aa
   where aa.admin_id in (select id from auth.users where email like '%scale.invalid%');
  delete from auth.users where email like '%scale.invalid%';
  get diagnostics v_n = row_count;
  raise notice 'cleared % accounts from a previous corpus', v_n;

  -- ════════════════════════════════════════════════════════════════
  -- 1. ACCOUNTS
  -- ════════════════════════════════════════════════════════════════
  -- tg_handle_new_user fires on this insert and creates the profile,
  -- deriving role/first_name/surname from raw_user_meta_data — so the
  -- corpus goes through the same path a real signup does rather than
  -- writing public.profiles directly. It also enforces
  -- is_imperial_email() for role='student', which is why the student
  -- slice uses @imperial.ac.uk and only the non-student roles get the
  -- @scale.invalid domain... except that would leave students
  -- unidentifiable for cleanup. Instead every address ends
  -- @scale.invalid and students are assigned by UPDATE below, after the
  -- trigger has run.
  --
  -- The eight token columns are set to '' EXPLICITLY, not left to
  -- default. They are nullable in the schema but GoTrue scans them into
  -- non-nullable Go strings, so a single row with NULLs makes
  -- `auth.admin.listUsers()` fail with "Database error finding users"
  -- for the WHOLE table — which is how one hand-seeded admin row took
  -- out the entire Playwright suite at global-setup on 2026-09-08. A
  -- 2000-row corpus of them would be the same outage, 2000 times over.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data
  )
  select
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'scale' || i || '@scale.invalid',
    crypt('not-a-real-password', gen_salt('bf')),
    now(), now() - (random() * interval '400 days'), now(),
    '', '', '', '', '', '', '', '',
    jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
    jsonb_build_object(
      'role', 'alum',           -- trigger-safe; corrected in step 2
      'first_name', (array['Ada','Blake','Chi','Dara','Eli','Fen','Gus','Hana',
                           'Ines','Jae','Kit','Lena','Mo','Nia','Omar','Pia',
                           'Quinn','Rae','Sol','Tao','Uma','Vik','Wren','Xan',
                           'Yara','Zane'])[1 + (i % 26)],
      'surname',    (array['Adeyemi','Bianchi','Chen','Dubois','Eriksen','Farah',
                           'Gupta','Haddad','Ivanov','Jensen','Kowalski','Lindqvist',
                           'Moreau','Nakamura','Okonkwo','Petrov','Quiroga','Rossi',
                           'Silva','Tanaka','Ueda','Varga','Weber','Xu','Yilmaz',
                           'Zhang'])[1 + ((i * 7) % 26)]
    )
  from generate_series(1, n_members) as g(i);
  get diagnostics v_n = row_count;
  raise notice 'inserted % auth users (profiles created by trigger)', v_n;

  -- ════════════════════════════════════════════════════════════════
  -- 2. PROFILE SHAPE
  -- ════════════════════════════════════════════════════════════════
  -- Role and status mix chosen to match the real population rather than
  -- a uniform split: the directory's hot query filters on status =
  -- 'approved', so a corpus that is 100% approved would flatter every
  -- plan by removing the selectivity the planner actually sees.
  with numbered as (
    select p.id, row_number() over (order by p.created_at, p.id) as rn
      from public.profiles p
      join auth.users u on u.id = p.id
     where u.email like '%@scale.invalid'
  )
  update public.profiles p set
    role = case
             when n.rn <= n_members * 0.60 then 'student'
             when n.rn <= n_members * 0.85 then 'alum'
             when n.rn <= n_members * 0.92 then 'recent_grad'
             when n.rn <= n_members * 0.97 then 'mentor'
             when n.rn <= n_members * 0.99 then 'angel'
             else 'staff_faculty'
           end::public.user_role,
    status = case
               when n.rn % 20 = 0 then 'pending_review'
               when n.rn % 37 = 0 then 'pending_onboarding'
               when n.rn % 97 = 0 then 'rejected'
               else 'approved'
             end::public.user_status,
    course = (array['Computing','Electrical & Electronic Engineering','Mechanical Engineering',
                    'Bioengineering','Physics','Mathematics','Chemical Engineering','Medicine',
                    'Business (MSc)','Design Engineering','Aeronautics','Materials',
                    'Earth Science','Chemistry','Civil Engineering'])[1 + (n.rn % 15)],
    grad_year = 2019 + (n.rn % 9),
    bio = 'Working on ' || (array['a payments API','an ML tooling startup','a biotech spinout',
           'a climate hardware project','a marketplace for tutors','a robotics controller',
           'a fintech compliance tool','a developer platform'])[1 + (n.rn % 8)]
          || '. Previously at ' || (array['a seed-stage startup','a national lab','a consultancy',
           'a bank','a research group','a scale-up'])[1 + (n.rn % 6)] || '.',
    working_on = (array['Fundraising','Hiring a co-founder','Finding a first customer',
                        'Shipping v1','Nothing right now'])[1 + (n.rn % 5)],
    -- Both of these are CHECK-constrained to a closed vocabulary
    -- (profiles_venture_stage_check / profiles_recruiting_status_check).
    -- Plausible-looking values are not enough — use the real ones.
    venture_stage = case when n.rn % 4 = 0 then
      (array['exploring_ideas','validating','building_mvp','launched_early_users',
             'generating_revenue','raised_funding'])[1 + (n.rn % 6)] end,
    venture_name  = case when n.rn % 4 = 0 then 'Venture ' || n.rn end,
    recruiting_status = (array['not_right_now','co_founder','first_hires',
                               'interns','advisors'])[1 + (n.rn % 5)],
    is_committee  = (n.rn % 200 = 0),
    committee_role = case when n.rn % 200 = 0 then 'Committee member' end,
    intake_completed_at = case when n.rn % 6 <> 0 then now() - (random() * interval '200 days') end,
    -- profile_version has to agree with intake_completed_at, and it was
    -- missing here until the Connections benchmark gate needed it:
    -- send_connection_request requires profile_version >= 2 (an empty
    -- profile card gives the recipient nothing to decide on), so a
    -- corpus left at the default 1 has 5,000 members who cannot send a
    -- single request, and the send path cannot be measured at all.
    --
    -- It was always wrong, just never load-bearing: the same 1-in-6 that
    -- has no intake_completed_at keeps version 1, which is exactly the
    -- "joined under the old form, never finished intake" population
    -- 20260828000003 describes.
    profile_version = case when n.rn % 6 <> 0 then 2 else 1 end,
    cv_parse_consent = (n.rn % 5 <> 0)
  from numbered n
  where p.id = n.id;
  get diagnostics v_n = row_count;
  raise notice 'shaped % profiles', v_n;

  -- ── An admin, but only if there is not one already ─────────────────
  -- scale_query_plans.sql section 5 measures admin_list_profiles, which
  -- gates on is_admin() — "who are you", not "what role do you hold", so
  -- a service_role claim does not satisfy it. With `public.admins`
  -- empty, its \gset returns no rows, the substitution fails, and
  -- because the whole harness runs in ONE transaction that first error
  -- aborts every section after it, including the connections gate.
  --
  -- Guarded on `not exists` rather than unconditional: on a stack that
  -- already has a real admin, that admin is used and no fake account is
  -- ever granted admin alongside them. On a fresh `supabase db reset`
  -- there is nobody, and this is what makes the harness runnable at all.
  if not exists (select 1 from public.admins) then
    select p.id into v_admin
      from public.profiles p
      join auth.users au on au.id = p.id
     where au.email like '%scale.invalid%' and p.status = 'approved'
     order by p.id
     limit 1;

    if v_admin is not null then
      insert into public.admins (user_id) values (v_admin) on conflict do nothing;
      raise notice 'promoted corpus member % to admin (none existed)', v_admin;
    end if;
  end if;

  -- Students must hold an Imperial address (is_imperial_email, enforced
  -- by tg_handle_new_user on INSERT and by the domain re-check trigger
  -- from 20260603000001). The corpus assigns roles after the fact, so
  -- the addresses are rewritten to match rather than the other way
  -- round. The @scale.invalid marker is kept as a subdomain so cleanup
  -- and the production guard above still find every row.
  update auth.users u
     set email = replace(u.email, '@scale.invalid', '.scale.invalid@imperial.ac.uk')
    from public.profiles p
   where p.id = u.id and p.role = 'student' and u.email like '%@scale.invalid';
  get diagnostics v_n = row_count;
  raise notice 'moved % student accounts onto @imperial.ac.uk', v_n;

  -- ════════════════════════════════════════════════════════════════
  -- 3. TAXONOMY JOINS — profile_skills / profile_sectors
  -- ════════════════════════════════════════════════════════════════
  -- These are what the directory's skill/sector filters join through, so
  -- an empty pair of join tables would make every directory plan look
  -- free. ~6 skills and ~2 sectors per member.
  insert into public.profile_skills (profile_id, skill_id)
  select p.id, s.id
    from public.profiles p
    join auth.users u on u.id = p.id
   cross join lateral (
     select sk.id from public.skills sk
      order by md5(sk.id::text || p.id::text)
      limit 4 + (abs(hashtext(p.id::text)) % 5)
   ) s
   where u.email like '%scale.invalid%'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'inserted % profile_skills', v_n;

  insert into public.profile_sectors (profile_id, sector_id)
  select p.id, s.id
    from public.profiles p
    join auth.users u on u.id = p.id
   cross join lateral (
     select se.id from public.sectors se
      order by md5(se.id::text || p.id::text)
      limit 1 + (abs(hashtext(p.id::text)) % 3)
   ) s
   where u.email like '%scale.invalid%'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'inserted % profile_sectors', v_n;

  -- ════════════════════════════════════════════════════════════════
  -- 4. LISTINGS
  -- ════════════════════════════════════════════════════════════════
  -- Status mix matters here for the same reason as profiles: the public
  -- list RPCs filter status = 'approved' and expiry, so a corpus of
  -- entirely-approved, entirely-future listings measures the wrong plan.
  -- All three listing tables carry the same pair of consistency CHECKs
  -- (<table>_approval_metadata and <table>_rejected_reason_consistency):
  -- approved/rejected/expired need BOTH approved_at and approved_by,
  -- pending needs both NULL, and rejected needs a rejected_reason that
  -- every other status must not have. Seeding a status without its
  -- companion columns is the single easiest way to fail this script.
  insert into public.events (
    posted_by, title, description, luma_link, event_at, location,
    organiser_name, contact_email, contact_email_visible,
    status, approved_at, approved_by, rejected_reason, is_society_event
  )
  select
    p.id,
    'Event ' || i || ': ' || (array['Founder AMA','Pitch Night','Demo Day','Workshop',
                                    'Panel','Hack Night','Coffee Morning'])[1 + (i % 7)],
    repeat('An evening for founders and would-be founders. ', 6),
    'https://lu.ma/scale-' || i,
    now() + ((i % 120) - 40) * interval '1 day',
    (array['Huxley 340','Blackett LT1','SCR, Sherfield','City & Guilds 200',
           'Imperial White City','Online'])[1 + (i % 6)],
    'Imperial Entrepreneurs',
    'events' || i || '@scale.invalid',
    (i % 3 = 0),
    (case when i % 11 = 0 then 'pending' when i % 23 = 0 then 'rejected' else 'approved' end)::public.listing_status,
    case when i % 11 <> 0 then now() - (i % 30) * interval '1 day' end,
    case when i % 11 <> 0 then p.id end,
    case when i % 11 <> 0 and i % 23 = 0 then 'Not a fit for the society calendar.' end,
    (i % 9 = 0)
  from generate_series(1, n_events) g(i)
  cross join lateral (
    select pr.id from public.profiles pr
     join auth.users au on au.id = pr.id
    where au.email like '%scale.invalid%' and pr.status = 'approved'
    order by md5(pr.id::text || i::text) limit 1
  ) p;
  get diagnostics v_n = row_count;
  raise notice 'inserted % events', v_n;

  insert into public.opportunities (
    posted_by, position_name, company, pay, location_type, description,
    start_month, start_year, application_deadline, contact_email, apply_method,
    apply_url, contact_email_visible,
    status, approved_at, approved_by, rejected_reason
  )
  select
    p.id,
    (array['Founding Engineer','Software Engineer Intern','Product Designer',
           'Data Scientist','Growth Lead','Research Engineer'])[1 + (i % 6)],
    'Company ' || i,
    (array['£35,000','£45,000–£55,000','Equity only','£20/hr','Competitive'])[1 + (i % 5)],
    (array['remote','hybrid','onsite'])[1 + (i % 3)]::public.location_type,
    repeat('We are looking for someone early in their career to own a real surface. ', 5),
    1 + (i % 12), 2026 + (i % 2),
    (current_date + ((i % 90) - 20))::date,
    'jobs' || i || '@scale.invalid',
    (case when i % 2 = 0 then 'link' else 'email' end)::public.apply_method,
    case when i % 2 = 0 then 'https://example.invalid/apply/' || i end,
    (i % 4 = 0),
    (case when i % 13 = 0 then 'pending' when i % 29 = 0 then 'rejected' else 'approved' end)::public.listing_status,
    case when i % 13 <> 0 then now() - (i % 30) * interval '1 day' end,
    case when i % 13 <> 0 then p.id end,
    case when i % 13 <> 0 and i % 29 = 0 then 'Role is outside what the board carries.' end
  from generate_series(1, n_opps) g(i)
  cross join lateral (
    select pr.id from public.profiles pr
     join auth.users au on au.id = pr.id
    where au.email like '%scale.invalid%' and pr.status = 'approved'
    order by md5(pr.id::text || i::text) limit 1
  ) p;
  get diagnostics v_n = row_count;
  raise notice 'inserted % opportunities', v_n;

  insert into public.opportunity_skills (opportunity_id, skill_id)
  select o.id, s.id
    from public.opportunities o
   cross join lateral (
     select sk.id from public.skills sk order by md5(sk.id::text || o.id::text) limit 3
   ) s
  on conflict do nothing;

  insert into public.opportunity_sectors (opportunity_id, sector_id)
  select o.id, s.id
    from public.opportunities o
   cross join lateral (
     select se.id from public.sectors se order by md5(se.id::text || o.id::text) limit 1
   ) s
  on conflict do nothing;

  insert into public.vcs_grants (
    kind, posted_by, name, description, link, status, approved_at, approved_by
  )
  select
    (case when i % 2 = 0 then 'vc' else 'grant' end)::public.vc_grant_kind,
    p.id,
    (case when i % 2 = 0 then 'Fund ' else 'Grant ' end) || i,
    repeat('Backs pre-seed technical founders out of UK universities. ', 4),
    'https://example.invalid/fund/' || i,
    (case when i % 12 = 0 then 'pending' else 'approved' end)::public.listing_status,
    case when i % 12 <> 0 then now() - (i % 30) * interval '1 day' end,
    case when i % 12 <> 0 then p.id end
  from generate_series(1, n_vcs) g(i)
  cross join lateral (
    select pr.id from public.profiles pr
     join auth.users au on au.id = pr.id
    where au.email like '%scale.invalid%' and pr.status = 'approved'
    order by md5(pr.id::text || i::text) limit 1
  ) p;
  get diagnostics v_n = row_count;
  raise notice 'inserted % vcs_grants', v_n;

  -- ════════════════════════════════════════════════════════════════
  -- 5. COMMUNITY FEED
  -- ════════════════════════════════════════════════════════════════
  insert into public.posts (author_id, title, body, created_at)
  select p.id,
         'Post ' || i || ': ' || (array['Looking for a co-founder','Shipped something',
            'Question about incorporation','Hiring','Sharing a template'])[1 + (i % 5)],
         repeat('Some reasonably long body text, of the kind a member actually writes. ', 8),
         now() - (i * interval '3 hours')
  from generate_series(1, n_posts) g(i)
  cross join lateral (
    select pr.id from public.profiles pr
     join auth.users au on au.id = pr.id
    where au.email like '%scale.invalid%' and pr.status = 'approved'
    order by md5(pr.id::text || i::text) limit 1
  ) p;
  get diagnostics v_n = row_count;
  raise notice 'inserted % posts', v_n;

  insert into public.post_likes (post_id, user_id)
  select po.id, u.id
    from public.posts po
   cross join lateral (
     select pr.id from public.profiles pr
      join auth.users au on au.id = pr.id
     where au.email like '%scale.invalid%' and pr.status = 'approved'
     order by md5(pr.id::text || po.id::text)
     limit (abs(hashtext(po.id::text)) % 12)
   ) u
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'inserted % post_likes', v_n;

  -- ════════════════════════════════════════════════════════════════
  -- 6. ANALYTICS — listing_events
  -- ════════════════════════════════════════════════════════════════
  -- The table that grows fastest per active member and is never read on
  -- a hot path, so it is here to make the *table sizes* honest rather
  -- than because a query touches it.
  --
  -- `listing_events_unique_view_idx` is UNIQUE on
  -- (listing_kind, listing_id, viewer_id, event_type), so this table is
  -- deduped by construction: it cannot exceed members × listings × 4,
  -- and re-viewing a listing writes nothing. That is a real bound the
  -- B0 audit did not account for when it called this the fastest-growing
  -- table — worth carrying into the findings. Randomly-drawn tuples
  -- collide long before n_lev rows exist, hence `on conflict do nothing`
  -- and an actual count that lands below the knob.
  insert into public.listing_events (listing_kind, listing_id, viewer_id, event_type, created_at)
  select
    'event'::public.listing_event_kind,
    e.id, v.id,
    (array['expand','apply_click','contact_click','external_click'])[1 + (i % 4)]::public.listing_event_type,
    now() - (random() * interval '120 days')
  from generate_series(1, n_lev) g(i)
  cross join lateral (select id from public.events order by md5(id::text || i::text) limit 1) e
  cross join lateral (
    select pr.id from public.profiles pr
     join auth.users au on au.id = pr.id
    where au.email like '%scale.invalid%'
    order by md5(pr.id::text || i::text) limit 1
  ) v
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'inserted % listing_events', v_n;

  raise notice '── accounts, listings and feed seeded; embeddings next ──';
end;
$$;


-- ════════════════════════════════════════════════════════════════════
-- 7. CV MATCHMAKER CORPUS — cvs, cv_profiles, cv_chunks, member_skills,
--    github_connections
--
-- Separate DO block purely so the (slow) vector generation is its own
-- transaction and a failure here does not roll back the 20 minutes of
-- work above.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  n_cvs    constant int := 1200;
  n_chunks constant int := 10000;
  n_github constant int := 800;
  v_n      int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role','service_role')::text, true);
  perform set_config('foundry.media_write', 'true', true);

  -- ── The same production guard as block 1, repeated deliberately ─────
  -- These are two DO blocks, so they are two TRANSACTIONS, and psql runs
  -- the second one whether or not the first raised. A guard that lives
  -- only in block 1 therefore protects nothing: abort there and this
  -- block still opens and starts writing. Repeat it, or the split that
  -- exists to save 20 minutes of vector generation costs a safety check.
  if not (
    current_setting('app.settings.jwt_secret', true)
      = 'super-secret-jwt-token-with-at-least-32-characters-long'
  ) and exists (
    select 1 from auth.users
     where email not like '%scale.invalid%'
       and email not like '%e2e-%'
       and email not like '%@imperial.ac.uk'
  ) then
    raise exception
      'ABORT: this database contains accounts outside the test domains — refusing to seed';
  end if;

  -- A pool of base vectors, reused with jitter. See the header: what is
  -- being measured is the cost of reading 6KB × N rows off disk with no
  -- ANN index, and that cost does not depend on the numbers being
  -- independently random.
  create temporary table _vec_pool on commit drop as
  select i as slot,
         (select array_agg((random() * 2 - 1)::real) from generate_series(1, 1536))::vector(1536) as v
    from generate_series(0, 63) g(i);

  insert into public.cvs (member_id, blob_key, original_filename, mime_type,
                          raw_text, raw_text_hash, status, is_current, created_at)
  select p.id,
         'member-cvs/' || p.id || '/cv.pdf',
         'cv.pdf', 'application/pdf',
         repeat('Experience. Education. Skills. Projects. ', 200),
         md5(p.id::text),
         'ready'::public.cv_status,
         true,
         now() - (random() * interval '120 days')
    from (
      select pr.id from public.profiles pr
       join auth.users au on au.id = pr.id
      where au.email like '%scale.invalid%'
        and pr.status = 'approved'
        and pr.cv_parse_consent
      order by md5(pr.id::text)
      limit n_cvs
    ) p;
  get diagnostics v_n = row_count;
  raise notice 'inserted % cvs', v_n;

  insert into public.cv_profiles (cv_id, is_current, profile, summary, model_name,
                                  prompt_version, summary_source)
  select c.id, true,
         jsonb_build_object(
           'headline', 'Engineer and founder',
           'skills', jsonb_build_array('Python','TypeScript','Postgres'),
           'roles',  jsonb_build_array(jsonb_build_object('title','Software Engineer','org','A company'))
         ),
         repeat('A six-to-ten sentence summary of what this member has actually built. ', 9),
         'gpt-5.4-mini', 'v1', 'cv'
    from public.cvs c;
  get diagnostics v_n = row_count;
  raise notice 'inserted % cv_profiles', v_n;

  -- ~8 chunks per CV, capped at n_chunks overall.
  insert into public.cv_chunks (cv_id, member_id, is_current, chunk_type, content,
                                embedding, embedding_model)
  select c.id, c.member_id, true,
         (array['role','project','education','skills','summary'])[1 + (k % 5)]::public.cv_chunk_type,
         repeat('A chunk of CV prose long enough to be worth embedding. ', 12),
         (select vp.v from _vec_pool vp
           where vp.slot = (abs(hashtext(c.id::text || k::text)) % 64)),
         'text-embedding-3-small'
    from public.cvs c
   cross join generate_series(0, 7) g(k)
   limit n_chunks;
  get diagnostics v_n = row_count;
  raise notice 'inserted % cv_chunks (vector(1536) — this is the big one)', v_n;

  -- The skills taxonomy the matchmaker matches against. Seeded from the
  -- same 64-vector pool: SKILL_MATCH_THRESHOLD's behaviour under a real
  -- taxonomy size is a C1 question, but the *scan cost* of the table is
  -- a C2 one, and that only needs the row count to be right.
  insert into public.cv_skills (canonical_name, embedding)
  select 'scale skill ' || i,
         (select vp.v from _vec_pool vp where vp.slot = (i % 64))
    from generate_series(1, 5000) g(i)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'inserted % cv_skills', v_n;

  insert into public.member_skills (member_id, skill_id, raw_text, confidence, source)
  select c.member_id,
         case when k % 4 <> 0 then
           (select s.id from public.cv_skills s
             order by md5(s.id::text || c.id::text || k::text) limit 1)
         end,
         'skill ' || k,
         0.7 + (k % 3) * 0.1,
         case when k % 3 = 0 then 'github' else 'cv' end
    from public.cvs c
   cross join generate_series(1, 10) g(k);
  get diagnostics v_n = row_count;
  raise notice 'inserted % member_skills', v_n;

  -- access_token_encrypted is NOT NULL bytea. It is never decrypted here
  -- — nothing in this audit calls GitHub — so it gets bytes of the right
  -- shape and no more. Deliberately NOT a real pgp_sym_encrypt of a
  -- plausible token: a corpus row that decrypts to something
  -- token-shaped is a credential-looking string sitting in a fixture.
  insert into public.github_connections (
    member_id, github_user_id, github_username, access_token_encrypted,
    scan_status, last_scanned_at,
    github_signal, available_repos, showcase_repos, showcase_seen_repos
  )
  select p.id,
         100000 + row_number() over (order by p.id),
         'scaleuser' || row_number() over (order by p.id),
         decode('00', 'hex'),
         'ready',
         now() - (random() * interval '10 days'),
         jsonb_build_object(
           'languages', jsonb_build_object('Python', 40000, 'TypeScript', 25000),
           'themes',    jsonb_build_array('developer tooling','data pipelines'),
           'top_repos', jsonb_build_array(
             jsonb_build_object('name','repo-a','description','A thing','url','https://github.invalid/a'))
         ),
         (select jsonb_agg(jsonb_build_object(
            'name','repo-' || r, 'description','A repository', 'language','Python',
            'stargazers_count', r, 'url','https://github.invalid/repo-' || r,
            'pushed_at', to_char(now() - r * interval '5 days','YYYY-MM-DD"T"HH24:MI:SS"Z"')))
          from generate_series(1, 12) gr(r)),
         case when random() < 0.6 then jsonb_build_array(
           jsonb_build_object('name','repo-1','blurb','The one I am proudest of'),
           jsonb_build_object('name','repo-2','blurb',null)) end,
         (select array_agg('repo-' || r) from generate_series(1, 12) gr(r))
    from (
      select pr.id from public.profiles pr
       join auth.users au on au.id = pr.id
      where au.email like '%scale.invalid%' and pr.status = 'approved'
      order by md5(pr.id::text || 'gh')
      limit n_github
    ) p
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'inserted % github_connections', v_n;
end;
$$;


-- ════════════════════════════════════════════════════════════════════
-- 8. CONNECTIONS CORPUS — the Connections benchmark gate
--
-- Separate DO block because it is a different question from everything
-- above. The corpus so far measures "does a list RPC degrade with
-- membership". This measures "does a graph query degrade with DEGREE",
-- which is a different axis and the one connections actually lives on.
--
-- Target: 250,000 edges over 5,000 members — an average degree of 100,
-- roughly 2.5x what this community is expected to reach. Nothing in the
-- connections read path should care about the total: a member with 300
-- connections must cost the same at 5,000 members as at 200,000, because
-- every index is keyed on the member first.
--
-- ─── THE SKEW MEMBERS, AND WHY A UNIFORM CORPUS IS A BAD ONE ────────
-- Uniformly random edges give every member roughly the same degree, and
-- a plan that is fine for everybody at degree 100 tells you nothing
-- about the person the feature will actually break for. Two deliberate
-- outliers are seeded at the end:
--
--   the HUB   ~2000 connections — the committee member or angel everyone
--             wants to reach. If list_my_connections degrades, it
--             degrades here first, and this is the account whose page
--             gets opened at the careers evening.
--   the ISOLATE  zero connections — the cold-start path, and the one
--             that silently returns an empty page if a join is wrong.
--
-- ─── WHY 'requested' EVENTS ARE SEEDED TOO ──────────────────────────
-- connection_assert_can_send counts daily and weekly sends from
-- connection_events, NOT from connections.created_at (a re-request
-- reuses and resets the row, so row counts under-count). That count is
-- on the hot path of every send, so the events table has to be the right
-- size for the measurement to mean anything.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  n_connections constant int := 250000;
  n_hub_edges   constant int := 2000;

  v_ids   uuid[];
  v_cnt   int;
  v_hub   uuid;
  v_n     int;
  v_cv    text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role','service_role')::text, true);

  -- Same production guard as the block above: keyed on the corpus email
  -- domain, so this can only ever touch accounts this file created.
  select array_agg(p.id order by p.id) into v_ids
    from public.profiles p
    join auth.users au on au.id = p.id
   where au.email like '%scale.invalid%'
     and p.status = 'approved';

  v_cnt := coalesce(array_length(v_ids, 1), 0);
  if v_cnt < 100 then
    raise notice 'skipping connections corpus: only % approved corpus members', v_cnt;
    return;
  end if;

  delete from public.connections c
   where c.requester_id = any(v_ids) or c.addressee_id = any(v_ids);
  delete from public.connection_events e
   where e.actor_id = any(v_ids) or e.subject_id = any(v_ids);

  v_cv := public.connection_consent_version();

  -- Random unordered pairs, deduplicated by the pair unique index rather
  -- than by generating distinct pairs up front. With 5000 members there
  -- are ~12.5M possible pairs, so 250k draws collide only ~2% of the
  -- time — cheaper to let the index reject them than to build a
  -- collision-free generator.
  --
  -- The status mix is weighted toward 'accepted' because that is what
  -- the read path scans, but every other status is present: a partial
  -- index is only proven by rows it has to skip.
  insert into public.connections (
    requester_id, addressee_id, status, note, consent_version,
    created_at, decided_at, digested_at, cooldown_until, blocked_by
  )
  select
    x.a, x.b, x.st,
    case when x.r2 < 0.4 then 'Corpus note ' || x.i else null end,
    case when x.st = 'accepted' then v_cv
         when x.st = 'pending'  then v_cv
         else null end,
    x.made,
    case when x.st = 'pending' then null else x.made + interval '2 days' end,
    case when x.st = 'pending' and x.r2 < 0.7 then x.made + interval '1 day' else null end,
    case when x.st in ('declined', 'withdrawn', 'removed')
         then x.made + interval '2 days' + interval '21 days' else null end,
    case when x.st = 'blocked' then x.a else null end
  from (
    select
      y.i, y.a, y.b, y.r2, y.made,
      case
        when y.r1 < 0.78 then 'accepted'
        when y.r1 < 0.88 then 'pending'
        when y.r1 < 0.93 then 'declined'
        when y.r1 < 0.96 then 'withdrawn'
        when y.r1 < 0.98 then 'expired'
        when y.r1 < 0.99 then 'removed'
        else 'blocked'
      end as st
    from (
      select
        g.i,
        v_ids[1 + floor(random() * v_cnt)::int] as a,
        v_ids[1 + floor(random() * v_cnt)::int] as b,
        random() as r1,
        random() as r2,
        now() - (random() * interval '300 days') as made
      from generate_series(1, n_connections) g(i)
      -- `offset 0` is an optimisation fence, and it is load-bearing.
      -- Without it the planner may pull this subquery up into the outer
      -- one, which references r1 six times in the CASE below — six
      -- independent random() draws per row instead of one, producing a
      -- status that does not match its own probability bands.
      --
      -- The first version of this used a non-correlated CROSS JOIN
      -- LATERAL instead, which failed the opposite way: the planner
      -- evaluated it ONCE for the whole statement, so all 250,000 rows
      -- were the same pair and exactly one survived the unique index.
      -- Correlating through generate_series is what makes the draws
      -- per-row.
      offset 0
    ) y
    where y.a <> y.b
  ) x
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'inserted % connections (of % attempted)', v_n, n_connections;

  -- ── The hub ────────────────────────────────────────────────────────
  -- v_ids[1] gets ~2000 accepted edges. Note `on conflict do nothing`
  -- again: many of these pairs already exist from the random fill, and
  -- the ones that do keep whatever status they were given, so the hub's
  -- real degree lands a little under n_hub_edges. That is fine — it is
  -- an order of magnitude, not a fixture to assert on.
  v_hub := v_ids[1];
  insert into public.connections (
    requester_id, addressee_id, status, consent_version, created_at, decided_at
  )
  select v_hub, t.id, 'accepted', v_cv,
         now() - (random() * interval '300 days'),
         now() - (random() * interval '200 days')
    from (
      select v_ids[1 + floor(random() * v_cnt)::int] as id
        from generate_series(1, n_hub_edges)
    ) t
   where t.id <> v_hub
  on conflict do nothing;

  select count(*) into v_n from public.connections
   where status = 'accepted' and (requester_id = v_hub or addressee_id = v_hub);
  raise notice 'hub member % has % accepted connections', v_hub, v_n;

  -- ── The isolate ────────────────────────────────────────────────────
  -- v_ids[2] is stripped of every edge, in every status. The cold-start
  -- path has to return an empty page, not an error and not everybody.
  delete from public.connections
   where requester_id = v_ids[2] or addressee_id = v_ids[2];
  raise notice 'isolate member % has 0 connections', v_ids[2];

  -- ── The event log ──────────────────────────────────────────────────
  -- One 'requested' event per connection, which is what the daily and
  -- weekly cap counts scan. Dated to match the connection so the rolling
  -- 24h/7d windows select a realistic slice rather than all or nothing.
  insert into public.connection_events (connection_id, actor_id, subject_id, event, created_at)
  select c.id, c.requester_id, c.addressee_id, 'requested', c.created_at
    from public.connections c
   where c.requester_id = any(v_ids);
  get diagnostics v_n = row_count;
  raise notice 'inserted % connection_events', v_n;

  -- A handful of reputation signals against the hub, so
  -- connection_sender_throttled has rows to scan rather than being
  -- measured against an empty table.
  insert into public.connection_events (connection_id, actor_id, subject_id, event, created_at)
  select gen_random_uuid(), v_ids[2 + i], v_hub, 'blocked', now() - (i * interval '3 days')
    from generate_series(1, 3) g(i);
end;
$$;

analyze;

-- ─── Report what the corpus actually is ──────────────────────────────
select relname as table_name,
       to_char(n_live_tup, 'FM999,999,999')      as approx_rows,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size
  from pg_stat_user_tables
 where schemaname = 'public'
   and n_live_tup > 0
 order by pg_total_relation_size(relid) desc;

select pg_size_pretty(pg_database_size(current_database())) as database_size;
