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
  n_members  constant int := 2000;
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
    cv_parse_consent = (n.rn % 5 <> 0)
  from numbered n
  where p.id = n.id;
  get diagnostics v_n = row_count;
  raise notice 'shaped % profiles', v_n;

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
