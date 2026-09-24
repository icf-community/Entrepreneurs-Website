-- ════════════════════════════════════════════════════════════════════
-- Foundry · /home's "newest" strips: fetch three rows, not every row
--
-- /home shows the three most recently added events and opportunities. It
-- got them by calling list_approved_events() and
-- list_approved_opportunities() — every open listing, descriptions and
-- all — and throwing all but three away in JavaScript. Measured per /home
-- load (2026-09-24, 5k-member corpus): 8 ms of the page's 18 ms of
-- database time, most of it PostgREST serialising ~400 rows nobody sees.
--
-- These return only what the home cards render, which is also why they
-- are safe by construction: no contact_email, no poster fields, nothing
-- that varies by viewer. Visibility is the same gate as the full lists —
-- approved, still open, and the caller approved (or an admin).
--
-- Ordering matches what /home did in JS: created_at newest first, ties in
-- the full list's order (event_at / application_deadline ascending).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.list_newest_events(p_limit int default 3)
returns table (
  id               uuid,
  title            text,
  event_at         timestamptz,
  location         text,
  is_society_event boolean,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select e.id, e.title, e.event_at, e.location, e.is_society_event, e.created_at
    from public.events e
   where e.status = 'approved'
     and e.event_at >= now()
     and (public.is_approved() or public.is_admin())
   order by e.created_at desc, e.event_at asc, e.id
   limit greatest(1, least(coalesce(p_limit, 3), 20));
$$;

create or replace function public.list_newest_opportunities(p_limit int default 3)
returns table (
  id            uuid,
  position_name text,
  company       text,
  location_type public.location_type,
  location_text text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select o.id, o.position_name, o.company, o.location_type, o.location_text, o.created_at
    from public.opportunities o
   where o.status = 'approved'
     and o.application_deadline >= current_date
     and (public.is_approved() or public.is_admin())
   order by o.created_at desc, o.application_deadline asc, o.id
   limit greatest(1, least(coalesce(p_limit, 3), 20));
$$;

-- REVOKE FROM public alone is a no-op on Supabase (default privileges
-- grant anon directly) — see 20260608000001 and 20260827000001.
revoke execute on function public.list_newest_events(int)        from public, anon;
revoke execute on function public.list_newest_opportunities(int) from public, anon;
grant  execute on function public.list_newest_events(int)        to authenticated;
grant  execute on function public.list_newest_opportunities(int) to authenticated;
