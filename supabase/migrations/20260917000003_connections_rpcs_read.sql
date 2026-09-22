-- ════════════════════════════════════════════════════════════════════
-- Foundry · Connections — read-path RPCs
--
-- THE EMAIL IS READ LIVE FROM auth.users, EVERY TIME, AND NEVER
-- SNAPSHOTTED ANYWHERE. `connections` has no email column and must never
-- grow one. A member who changes their login address (email_change_log
-- exists) must not leave a stale address sitting in other people's
-- connection lists, and a copied address would be a retention problem of
-- its own — one that survives erasure requests by hiding in a table
-- nobody thinks of as holding contact details.
--
-- BOTH PARTIES ARE RE-CHECKED AS `approved` ON EVERY READ, not merely at
-- accept. A member banned after the handshake stops appearing in the
-- other party's list and their address stops being returned. This is the
-- only thing standing between a ban and an address that keeps working
-- forever, so every function below carries the same
-- `op.status = 'approved'` predicate.
--
-- ─── WHY UNION ALL AND NOT `requester_id = me OR addressee_id = me` ──
-- One row per pair means "my connections" spans both id columns. An OR
-- across two columns gives the planner a choice it regularly gets wrong
-- — a bitmap heap scan, or a seq scan once the table is big enough —
-- whereas a UNION ALL of two branches is two index descents into two
-- purpose-built partial indexes, each already sorted on the key the
-- query orders by. The merge is then free.
--
-- The two indexes are connections_accepted_requester_idx and
-- connections_accepted_addressee_idx from 20260917000001, and they are
-- shaped `(<side>_id, decided_at desc) where status = 'accepted'`
-- precisely so this stays true.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. list_my_connections ─────────────────────────────────────────
-- The card view. KEYSET PAGINATION, not OFFSET: the cursor is
-- (decided_at, id), matching the index order exactly. OFFSET degrades
-- linearly on deep pages, which is precisely the case a well-connected
-- member hits — the one person for whom this page needs to be fast.
--
-- total_count is meaningful on the FIRST page only (p_cursor_id null)
-- and returns 0 thereafter. Not a scan saving — the window runs over one
-- member's own edges either way, which is hundreds of rows — but a count
-- that changes as you scroll is a UI bug, and returning 0 makes it
-- impossible for the client to render one by accident.
create or replace function public.list_my_connections(
  p_query             text        default null,
  p_roles             text[]      default null,
  p_courses           text[]      default null,
  p_sectors           text[]      default null,
  p_skills            text[]      default null,
  p_grad_min          int         default null,
  p_grad_max          int         default null,
  p_limit             int         default 48,
  p_cursor_decided_at timestamptz default null,
  p_cursor_id         uuid        default null
)
returns table (
  connection_id uuid,
  connected_at  timestamptz,
  id            uuid,
  first_name    text,
  surname       text,
  role          public.user_role,
  course        text,
  grad_year     smallint,
  avatar_path   text,
  bio_focus     text,
  bio_hobbies   text,
  email         text,
  skill_names   text[],
  sector_names  text[],
  total_count   bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  -- Hoisted out of the row predicate for the same reason
  -- 20260908000001 hoisted them in the directory: run once, not once per
  -- candidate. Both return no rows without a text query, so the
  -- membership tests below are false and cost nothing.
  with q_skill_ids as materialized (
    select s.id from public.skills s
     where p_query is not null and p_query <> '' and s.name ilike '%' || p_query || '%'
  ),
  q_sector_ids as materialized (
    select sc.id from public.sectors sc
     where p_query is not null and p_query <> '' and sc.name ilike '%' || p_query || '%'
  ),
  -- The k_ prefix on every internal key is not decoration. These CTEs
  -- carry `op.*` from profiles, and RETURNS TABLE column names are in
  -- scope inside a SQL function body — so an internal column called
  -- `id`, `created_at` or `connection_id` is two collisions waiting to
  -- happen, one with the profile row and one with the output parameter.
  -- Prefixing makes both impossible.
  edges as (
    select c.id as k_conn_id, c.addressee_id as k_other_id, c.decided_at as k_sort_at
      from public.connections c
     where c.requester_id = auth.uid()
       and c.status = 'accepted'
       and (public.is_approved() or public.is_admin())
    union all
    select c.id, c.requester_id, c.decided_at
      from public.connections c
     where c.addressee_id = auth.uid()
       and c.status = 'accepted'
       and (public.is_approved() or public.is_admin())
  ),
  matched as (
    select e.k_conn_id, e.k_sort_at, op.*
      from edges e
      join public.profiles op on op.id = e.k_other_id
     -- The ban re-check. Not optional, and not a duplicate of the one in
     -- respond_to_connection_request: that one guards the disclosure,
     -- this one guards every disclosure after it.
     where op.status = 'approved'
       and (p_roles    is null or op.role::text = any(p_roles))
       and (p_courses  is null or op.course     = any(p_courses))
       and (p_grad_min is null or (op.grad_year is not null and op.grad_year >= p_grad_min))
       and (p_grad_max is null or (op.grad_year is not null and op.grad_year <= p_grad_max))
       and (
         p_query is null or p_query = '' or
         (op.first_name || ' ' || op.surname) ilike '%' || p_query || '%' or
         op.course      ilike '%' || p_query || '%' or
         op.bio_focus   ilike '%' || p_query || '%' or
         op.bio_hobbies ilike '%' || p_query || '%' or
         op.working_on  ilike '%' || p_query || '%' or
         exists (select 1 from public.profile_skills ps
                  where ps.profile_id = op.id and ps.skill_id in (select id from q_skill_ids)) or
         exists (select 1 from public.profile_sectors psc
                  where psc.profile_id = op.id and psc.sector_id in (select id from q_sector_ids))
       )
       and (
         p_sectors is null or exists (
           select 1 from public.profile_sectors psc
             join public.sectors sc on sc.id = psc.sector_id
            where psc.profile_id = op.id and sc.name = any(p_sectors)
         )
       )
       and (
         p_skills is null or exists (
           select 1 from public.profile_skills ps
             join public.skills s on s.id = ps.skill_id
            where ps.profile_id = op.id and s.name = any(p_skills)
         )
       )
  ),
  counted as (
    select m.*,
           case when p_cursor_id is null then count(*) over () else 0::bigint end as k_total
      from matched m
  ),
  page as (
    select * from counted cn
     -- Row comparison, not two ORed predicates: `(a, b) < (x, y)` is a
     -- single comparison the planner can turn into an index bound, and
     -- it is the only form that is correct at a tie on decided_at.
     where p_cursor_decided_at is null
        or p_cursor_id is null
        or (cn.k_sort_at, cn.k_conn_id) < (p_cursor_decided_at, p_cursor_id)
     order by cn.k_sort_at desc, cn.k_conn_id desc
     limit greatest(1, least(coalesce(p_limit, 48), 100))
  )
  select
    pg.k_conn_id,
    pg.k_sort_at,
    pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year,
    pg.avatar_path,
    left(coalesce(pg.bio_focus, pg.working_on), 160),
    left(pg.bio_hobbies, 160),
    -- THE ONE THING THIS WHOLE FEATURE EXISTS TO RETURN. Joined live,
    -- inside the page CTE, so it is read for at most 100 rows and only
    -- for members who are still approved.
    u.email::text,
    coalesce((
      select array_agg(s.name order by s.name)
        from public.profile_skills ps join public.skills s on s.id = ps.skill_id
       where ps.profile_id = pg.id
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(sc.name order by sc.name)
        from public.profile_sectors psc join public.sectors sc on sc.id = psc.sector_id
       where psc.profile_id = pg.id
    ), ARRAY[]::text[]),
    pg.k_total
  from page pg
  join auth.users u on u.id = pg.id;
$$;

revoke execute on function public.list_my_connections(
  text, text[], text[], text[], text[], int, int, int, timestamptz, uuid
) from public, anon;
grant execute on function public.list_my_connections(
  text, text[], text[], text[], text[], int, int, int, timestamptz, uuid
) to authenticated;


-- ─── 2. list_my_pending_requests ────────────────────────────────────
-- The inbox: requests waiting on the caller, with the sender's card and
-- their note.
--
-- NO EMAIL. The whole point of the handshake is that the address is not
-- released until accept, so the decision screen cannot carry it.
--
-- Pending rows from members who are no longer approved are filtered out
-- rather than shown and refused. A banned member's request sitting in
-- someone's inbox is an invitation to a support ticket about a person
-- who is no longer here.
create or replace function public.list_my_pending_requests(
  p_limit            int         default 48,
  p_cursor_created_at timestamptz default null,
  p_cursor_id        uuid        default null
)
returns table (
  connection_id uuid,
  requested_at  timestamptz,
  note          text,
  id            uuid,
  first_name    text,
  surname       text,
  role          public.user_role,
  course        text,
  grad_year     smallint,
  avatar_path   text,
  bio_focus     text,
  bio_hobbies   text,
  skill_names   text[],
  sector_names  text[],
  total_count   bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  -- k_ prefixes for the same reason as list_my_connections, and here it
  -- is load-bearing rather than defensive: `op.*` brings profiles'
  -- OWN created_at along, so an unaliased c.created_at would give this
  -- CTE two columns of that name and make every later reference to it
  -- ambiguous.
  with matched as (
    select c.id as k_conn_id, c.created_at as k_sort_at, c.note as k_note, op.*
      from public.connections c
      join public.profiles op on op.id = c.requester_id
     where c.addressee_id = auth.uid()
       and c.status = 'pending'
       and op.status = 'approved'
       and (public.is_approved() or public.is_admin())
  ),
  counted as (
    select m.*,
           case when p_cursor_id is null then count(*) over () else 0::bigint end as k_total
      from matched m
  ),
  page as (
    select * from counted cn
     where p_cursor_created_at is null
        or p_cursor_id is null
        or (cn.k_sort_at, cn.k_conn_id) < (p_cursor_created_at, p_cursor_id)
     order by cn.k_sort_at desc, cn.k_conn_id desc
     limit greatest(1, least(coalesce(p_limit, 48), 100))
  )
  select
    pg.k_conn_id, pg.k_sort_at, pg.k_note,
    pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year,
    pg.avatar_path,
    left(coalesce(pg.bio_focus, pg.working_on), 160),
    left(pg.bio_hobbies, 160),
    coalesce((
      select array_agg(s.name order by s.name)
        from public.profile_skills ps join public.skills s on s.id = ps.skill_id
       where ps.profile_id = pg.id
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(sc.name order by sc.name)
        from public.profile_sectors psc join public.sectors sc on sc.id = psc.sector_id
       where psc.profile_id = pg.id
    ), ARRAY[]::text[]),
    pg.k_total
  from page pg
  -- NOT redundant with the ORDER BY inside `page`. A CTE's ordering is
  -- not preserved through the correlated subqueries and joins above —
  -- the planner may emit rows in any order — and the CLIENT DERIVES ITS
  -- KEYSET CURSOR FROM THE LAST ROW, so an unordered page hands back a
  -- cursor from the middle of itself and the next page overlaps.
  order by pg.k_sort_at desc, pg.k_conn_id desc;
$$;

revoke execute on function public.list_my_pending_requests(int, timestamptz, uuid) from public, anon;
grant  execute on function public.list_my_pending_requests(int, timestamptz, uuid) to authenticated;


-- ─── 3. list_my_sent_requests ───────────────────────────────────────
-- Outgoing pending only. A DECLINE VANISHES FROM HERE ENTIRELY — the
-- status leaves 'pending' and the row stops matching, which is what
-- makes decline silent. There is no "declined" tab and there must never
-- be one: a list of who turned you down is the feature that makes
-- declining feel unsafe.
--
-- The note is returned because the sender wrote it and re-reading your
-- own message before withdrawing is reasonable.
create or replace function public.list_my_sent_requests(
  p_limit             int         default 48,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null
)
returns table (
  connection_id uuid,
  requested_at  timestamptz,
  note          text,
  id            uuid,
  first_name    text,
  surname       text,
  role          public.user_role,
  course        text,
  grad_year     smallint,
  avatar_path   text,
  total_count   bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with matched as (
    select c.id as k_conn_id, c.created_at as k_sort_at, c.note as k_note, op.*
      from public.connections c
      join public.profiles op on op.id = c.addressee_id
     where c.requester_id = auth.uid()
       and c.status = 'pending'
       and op.status = 'approved'
       and (public.is_approved() or public.is_admin())
  ),
  counted as (
    select m.*,
           case when p_cursor_id is null then count(*) over () else 0::bigint end as k_total
      from matched m
  ),
  page as (
    select * from counted cn
     where p_cursor_created_at is null
        or p_cursor_id is null
        or (cn.k_sort_at, cn.k_conn_id) < (p_cursor_created_at, p_cursor_id)
     order by cn.k_sort_at desc, cn.k_conn_id desc
     limit greatest(1, least(coalesce(p_limit, 48), 100))
  )
  select
    pg.k_conn_id, pg.k_sort_at, pg.k_note,
    pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year,
    pg.avatar_path, pg.k_total
  from page pg
  -- Same cursor reasoning as list_my_pending_requests above.
  order by pg.k_sort_at desc, pg.k_conn_id desc;
$$;

revoke execute on function public.list_my_sent_requests(int, timestamptz, uuid) from public, anon;
grant  execute on function public.list_my_sent_requests(int, timestamptz, uuid) to authenticated;


-- ─── 4. connection_state_with ───────────────────────────────────────
-- Drives the single control in MemberDialog. Returns one of:
--
--   self             the caller is looking at themselves
--   connected        show the email and a Remove control
--   pending_outgoing show "Pending" and a Withdraw control
--   pending_incoming show Accept / Decline
--   blocked_by_me    show Unblock
--   unavailable      show NOTHING — no Connect control at all
--   none             show Connect
--
-- `unavailable` IS THE ANTI-PROBING STATE and it deliberately collapses
-- five distinct situations: they blocked the caller, the pair is on
-- cooldown, they have paused incoming requests, they are no longer
-- approved, and they do not exist. Splitting any of these out would let
-- a caller walk the directory and learn who has blocked them.
--
-- `blocked_by_me` is the one case that is safe to name, because the
-- caller is the one who did it — and without it there is no route to the
-- Unblock control.
create or replace function public.connection_state_with(p_member uuid)
returns table (state text, connection_id uuid)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
  v_status text;
  v_open   boolean;
begin
  if v_caller is null or not (public.is_approved() or public.is_admin()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if p_member is null then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  if p_member = v_caller then
    return query select 'self'::text, null::uuid;
    return;
  end if;

  select * into v_row
    from public.connections
   where least(requester_id, addressee_id)    = least(v_caller, p_member)
     and greatest(requester_id, addressee_id) = greatest(v_caller, p_member);

  if found then
    if v_row.status = 'accepted' then
      -- A connection to a banned member is not shown as a connection,
      -- for the same reason their address stops being returned.
      select p.status into v_status from public.profiles p where p.id = p_member;
      if v_status is distinct from 'approved' then
        return query select 'unavailable'::text, null::uuid;
      else
        return query select 'connected'::text, v_row.id;
      end if;
      return;
    end if;

    if v_row.status = 'pending' then
      if v_row.requester_id = v_caller then
        return query select 'pending_outgoing'::text, v_row.id;
      else
        return query select 'pending_incoming'::text, v_row.id;
      end if;
      return;
    end if;

    if v_row.status = 'blocked' then
      if v_row.blocked_by = v_caller then
        return query select 'blocked_by_me'::text, v_row.id;
      else
        return query select 'unavailable'::text, null::uuid;
      end if;
      return;
    end if;

    if v_row.cooldown_until is not null and v_row.cooldown_until > now() then
      return query select 'unavailable'::text, null::uuid;
      return;
    end if;
  end if;

  select p.status, p.open_to_connections into v_status, v_open
    from public.profiles p where p.id = p_member;

  if v_status is distinct from 'approved' or coalesce(v_open, false) = false then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  return query select 'none'::text, null::uuid;
end;
$$;

revoke execute on function public.connection_state_with(uuid) from public, anon;
grant  execute on function public.connection_state_with(uuid) to authenticated;


-- ─── 5. my_pending_connection_count ─────────────────────────────────
-- The sidebar badge, and THE HIGHEST-FREQUENCY QUERY IN THIS FEATURE by
-- a wide margin: it renders on every authenticated page.
--
-- DO NOT put it in Redis. A cache round trip costs more than this scan
-- and would spend the shared 500K/month Upstash budget on every page
-- view — the same budget the rate limiter fails closed against.
--
-- A NOTE ON THE JOIN, which is a deliberate deviation from the plan's
-- "index-only scan and nothing more": the join to profiles is what makes
-- the badge agree with list_my_pending_requests, which filters out
-- senders who are no longer approved. Without it a member sees "3" and
-- opens a list of 2, forever, with no way to clear it. The cost is one
-- PK lookup per pending row against a set bounded by how many people
-- have written to this member — hundreds at the very worst. Correctness
-- wins; the partial index still drives the outer scan.
create or replace function public.my_pending_connection_count()
returns int
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(count(*), 0)::int
    from public.connections c
    join public.profiles op on op.id = c.requester_id
   where c.addressee_id = auth.uid()
     and c.status = 'pending'
     and op.status = 'approved'
     and (public.is_approved() or public.is_admin());
$$;

revoke execute on function public.my_pending_connection_count() from public, anon;
grant  execute on function public.my_pending_connection_count() to authenticated;


-- ─── 6. list_my_connection_facets ───────────────────────────────────
-- The filter chips on /connections, scoped to the caller's OWN edges
-- rather than to the whole directory. Offering "Fintech" as a filter
-- when none of your connections is in fintech is a dead end, and at a
-- few hundred rows this costs nothing.
create or replace function public.list_my_connection_facets()
returns table (
  courses  text[],
  sectors  text[],
  skills   text[],
  grad_min int,
  grad_max int,
  total    bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with edges as (
    select c.addressee_id as k_other_id from public.connections c
     where c.requester_id = auth.uid() and c.status = 'accepted'
    union all
    select c.requester_id from public.connections c
     where c.addressee_id = auth.uid() and c.status = 'accepted'
  ),
  others as (
    select p.* from edges e join public.profiles p on p.id = e.k_other_id
     where p.status = 'approved'
  )
  select
    coalesce((
      select array_agg(distinct o.course order by o.course)
        from others o where o.course is not null and length(trim(o.course)) > 0
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(distinct s.name order by s.name)
        from others o
        join public.profile_sectors psc on psc.profile_id = o.id
        join public.sectors s on s.id = psc.sector_id
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(distinct s.name order by s.name)
        from others o
        join public.profile_skills ps on ps.profile_id = o.id
        join public.skills s on s.id = ps.skill_id
    ), ARRAY[]::text[]),
    (select min(o.grad_year)::int from others o where o.grad_year is not null),
    (select max(o.grad_year)::int from others o where o.grad_year is not null),
    (select count(*) from others o)
  where public.is_approved() or public.is_admin();
$$;

revoke execute on function public.list_my_connection_facets() from public, anon;
grant  execute on function public.list_my_connection_facets() to authenticated;


-- ─── 7. list_my_connection_graph ────────────────────────────────────
-- The ego-graph payload: YOU at the centre, YOUR connections around you.
--
-- ─── THE TWO THINGS THIS FUNCTION MUST NEVER DO ─────────────────────
--
-- 1. IT RETURNS NO EMAIL ADDRESSES. Not one, not optionally, not behind
--    a flag. The graph is a browsing surface; addresses live on the card
--    view and the detail surfaces where they are actually used. Keeping
--    the payload address-free means the graph view can never become an
--    accidental bulk-export endpoint, and rls_smoke asserts it.
--
-- 2. IT RETURNS ONLY EDGES THE CALLER IS PARTY TO. If the caller is
--    connected to 2, 3 and 4, and 2 and 3 are also connected to each
--    other, that 2–3 edge is NOT returned — which is why this function
--    returns nodes and no edge list at all: every edge is you-to-node by
--    construction, so there is nothing to get wrong. Those two consented
--    to share an address with the CALLER, not to have their own
--    relationships displayed. Rendering mutual edges is a separate
--    consent decision and is out of scope.
--
--    The same reasoning forbids an "N mutual connections" badge: at this
--    community's size a count of 1 IS an identification.
--
-- Clustering is done client-side from the attributes below, because it
-- is the VIEWER's choice of dimension (sector, role, course, grad year)
-- and re-querying on every toggle would be a round trip for a regroup of
-- a few hundred objects already in memory.
--
-- Hard-capped at 500 nodes. Beyond that the view renders aggregate
-- bubbles rather than dots — 400 dots is unreadable however fast it
-- paints — and total_count tells the client how many it is summarising.
create or replace function public.list_my_connection_graph()
returns table (
  id           uuid,
  first_name   text,
  surname      text,
  role         public.user_role,
  course       text,
  grad_year    smallint,
  avatar_path  text,
  connected_at timestamptz,
  skill_names  text[],
  sector_names text[],
  total_count  bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with edges as (
    select c.addressee_id as k_other_id, c.decided_at as k_sort_at from public.connections c
     where c.requester_id = auth.uid() and c.status = 'accepted'
       and (public.is_approved() or public.is_admin())
    union all
    select c.requester_id, c.decided_at from public.connections c
     where c.addressee_id = auth.uid() and c.status = 'accepted'
       and (public.is_approved() or public.is_admin())
  ),
  others as (
    select e.k_sort_at, p.*, count(*) over () as k_total
      from edges e join public.profiles p on p.id = e.k_other_id
     where p.status = 'approved'
  ),
  page as (
    select * from others o order by o.k_sort_at desc, o.id desc limit 500
  )
  select
    pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year,
    pg.avatar_path, pg.k_sort_at,
    coalesce((
      select array_agg(s.name order by s.name)
        from public.profile_skills ps join public.skills s on s.id = ps.skill_id
       where ps.profile_id = pg.id
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(sc.name order by sc.name)
        from public.profile_sectors psc join public.sectors sc on sc.id = psc.sector_id
       where psc.profile_id = pg.id
    ), ARRAY[]::text[]),
    pg.k_total
  from page pg
  -- No cursor here, but a stable order still matters: the 500-node cap
  -- means WHICH nodes come back is order-dependent, and a graph whose
  -- membership shuffles between two loads of the same data looks broken.
  order by pg.k_sort_at desc, pg.id desc;
$$;

revoke execute on function public.list_my_connection_graph() from public, anon;
grant  execute on function public.list_my_connection_graph() to authenticated;


-- ─── 8. my_connection_settings / set_connection_settings ────────────
-- The two profiles columns added in 20260917000001, exposed as a pair.
--
-- A SEPARATE RPC rather than widening the profile-update path, because
-- these two are not profile content: they are preference switches with
-- no validation, no moderation and no directory consequence, and folding
-- them into submit_intake / update_profile would mean every settings
-- toggle re-ran that function's validation of fields it never touched.
create or replace function public.my_connection_settings()
returns table (connection_emails_enabled boolean, open_to_connections boolean)
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.connection_emails_enabled, p.open_to_connections
    from public.profiles p
   where p.id = auth.uid()
     and (public.is_approved() or public.is_admin());
$$;

revoke execute on function public.my_connection_settings() from public, anon;
grant  execute on function public.my_connection_settings() to authenticated;

-- Null means "leave this one alone", so the two switches can be toggled
-- independently without the client having to read-modify-write a pair it
-- may be holding a stale copy of.
create or replace function public.set_connection_settings(
  p_emails_enabled boolean default null,
  p_open           boolean default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can change connection settings' using errcode = '42501';
  end if;

  update public.profiles
     set connection_emails_enabled = coalesce(p_emails_enabled, connection_emails_enabled),
         open_to_connections       = coalesce(p_open, open_to_connections)
   where id = v_caller;

  -- Deliberately NOT touching existing connections or pending requests.
  -- Pausing means "no new requests", not "cancel the forty people
  -- already waiting on me" — and someone who pauses because they are
  -- swamped still wants to clear the inbox that swamped them.
end;
$$;

revoke execute on function public.set_connection_settings(boolean, boolean) from public, anon;
grant  execute on function public.set_connection_settings(boolean, boolean) to authenticated;
