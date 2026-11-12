-- ════════════════════════════════════════════════════════════════════
-- Foundry · Incident banner (launch programme F-x4)
--
-- One site-wide message an admin can publish from /admin/banner, so that
-- when something breaks after launch, members can be told without a
-- deploy. Shown on every signed-in page and on /login, /pending and
-- /rejected: /login matters most, because a broken sign-in is exactly when
-- people look there.
--
-- Its own table rather than an app_config row: app_config holds
-- cron_secret, and admins must never get write access to a table that
-- holds a secret. Exactly one row (the id is pinned), deny-all RLS, and
-- three RPCs:
--   get_site_banner()         anyone, incl. logged-out; the live banner or nothing
--   admin_get_site_banner()   admin page state, incl. who changed it and when
--   admin_set_site_banner(…)  publish (bumps version) / admin_clear_site_banner()
-- Every publish and clear is written to admin_actions.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.site_banner (
  id          uuid primary key default '00000000-0000-0000-0000-00000000b4e1'
              check (id = '00000000-0000-0000-0000-00000000b4e1'),
  message     text not null default ''
              check (char_length(message) <= 200),
  severity    text not null default 'info'
              check (severity in ('info', 'warning', 'critical')),
  link_url    text
              check (link_url is null or (link_url ~ '^https://[^\s<>"]+$' and char_length(link_url) <= 500)),
  hide_after  timestamptz,
  enabled     boolean not null default false,
  -- Bumped on every publish, so a member who dismissed an older message
  -- sees the new one (the dismissal is keyed on this in their browser).
  version     integer not null default 0,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  -- A banner can't be switched on with nothing to say.
  check (not enabled or char_length(btrim(message)) > 0)
);

insert into public.site_banner (id) values ('00000000-0000-0000-0000-00000000b4e1')
on conflict (id) do nothing;

alter table public.site_banner enable row level security;
-- No policies: every read and write goes through the functions below.
revoke all on public.site_banner from anon, authenticated;

-- ─── The live banner, for everyone ─────────────────────────────────
create or replace function public.get_site_banner()
returns table (message text, severity text, link_url text, version integer)
language sql
stable
security definer
set search_path = public
as $$
  select b.message, b.severity, b.link_url, b.version
    from public.site_banner b
   where b.enabled
     and (b.hide_after is null or b.hide_after > now());
$$;

-- Deliberately callable by anon: /login shows the banner to people who
-- cannot sign in. It returns only what the banner already shows publicly.
revoke execute on function public.get_site_banner() from public;
grant  execute on function public.get_site_banner() to anon, authenticated;

-- ─── Admin page state ──────────────────────────────────────────────
create or replace function public.admin_get_site_banner()
returns table (
  message text, severity text, link_url text, hide_after timestamptz,
  enabled boolean, version integer, updated_at timestamptz, updated_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  return query
    select b.message, b.severity, b.link_url, b.hide_after, b.enabled, b.version, b.updated_at,
           nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '')
      from public.site_banner b
      left join public.profiles p on p.id = b.updated_by;
end;
$$;

revoke execute on function public.admin_get_site_banner() from public, anon;
grant  execute on function public.admin_get_site_banner() to authenticated;

-- ─── Publish ───────────────────────────────────────────────────────
create or replace function public.admin_set_site_banner(
  p_message    text,
  p_severity   text,
  p_link_url   text default null,
  p_hide_after timestamptz default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_message text := btrim(coalesce(p_message, ''));
  v_link    text := nullif(btrim(coalesce(p_link_url, '')), '');
  v_version integer;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if char_length(v_message) = 0 then
    raise exception 'Write a message for the banner.' using errcode = '22023';
  end if;
  if char_length(v_message) > 200 then
    raise exception 'Keep the banner message to 200 characters.' using errcode = '22023';
  end if;
  if p_severity not in ('info', 'warning', 'critical') then
    raise exception 'Choose info, warning or critical.' using errcode = '22023';
  end if;
  if v_link is not null and (v_link !~ '^https://[^\s<>"]+$' or char_length(v_link) > 500) then
    raise exception 'The link must be a full https:// address.' using errcode = '22023';
  end if;
  if p_hide_after is not null and p_hide_after <= now() then
    raise exception 'The hide time must be in the future.' using errcode = '22023';
  end if;

  update public.site_banner
     set message = v_message, severity = p_severity, link_url = v_link,
         hide_after = p_hide_after, enabled = true, version = version + 1,
         updated_by = v_caller, updated_at = now()
   where id = '00000000-0000-0000-0000-00000000b4e1'
  returning version into v_version;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'site_banner_publish', 'site_banner', '00000000-0000-0000-0000-00000000b4e1',
          p_severity || ': ' || v_message);

  return v_version;
end;
$$;

revoke execute on function public.admin_set_site_banner(text, text, text, timestamptz) from public, anon;
grant  execute on function public.admin_set_site_banner(text, text, text, timestamptz) to authenticated;

-- ─── Clear ─────────────────────────────────────────────────────────
create or replace function public.admin_clear_site_banner()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  update public.site_banner
     set enabled = false, updated_by = v_caller, updated_at = now()
   where id = '00000000-0000-0000-0000-00000000b4e1';

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'site_banner_clear', 'site_banner', '00000000-0000-0000-0000-00000000b4e1', null);
end;
$$;

revoke execute on function public.admin_clear_site_banner() from public, anon;
grant  execute on function public.admin_clear_site_banner() to authenticated;
