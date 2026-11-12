-- ════════════════════════════════════════════════════════════════════
-- Foundry · Push progress to the member's tab instead of being polled
--
-- The CV, GitHub and Foundry AI progress views polled a status RPC every
-- 1–8 s for as long as the work ran. Each poll was a billed Vercel call
-- plus a database read, and most of them returned "no change".
--
-- Now the row change itself announces that something moved. A trigger
-- broadcasts a content-free signal on the member's private Realtime topic
-- `member:<uuid>`, and the tab re-reads the status through the SAME RPC it
-- always used. The payload carries only a kind (and a turn id for AI
-- turns), never a status or any data, so authorisation stays in those
-- RPCs and a stray message can't show the wrong thing.
--
-- Cost: a tab opens the socket only while it is waiting on something, and
-- the client closes it when the work finishes (lib/realtime). That is a few
-- messages per job against the plan's message quota, and a connection held
-- for seconds, not for a whole session. The like counts on the community
-- feed are deliberately NOT here: every like would fan out to every open
-- feed, and that is the shape that runs up the message bill.
--
-- realtime.send never raises. It turns any failure into a WARNING, so a
-- broadcast problem can't fail the worker's or the member's write. Messages
-- are sent on commit, so a signal never gets ahead of the row it describes.
--
-- SECURITY DEFINER: the writers include the CV worker's and the AI runner's
-- restricted roles, which can't insert into realtime.messages. Without it
-- realtime.send would fail silently, as a WARNING, on exactly those paths.
-- ════════════════════════════════════════════════════════════════════

-- ─── Who may receive ───────────────────────────────────────────────
-- Select only, and only your own topic. There is no insert policy, so no
-- client can send on a member topic (its own or anyone else's). Every
-- message comes from the triggers below.
create policy "member receives own progress signals"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'member:' || (select auth.uid())::text
  );

-- ─── The signal ────────────────────────────────────────────────────
-- One function for the four tables. tg_argv[0] is the kind the client
-- listens for. The member column is read in an IF branch per table
-- because PL/pgSQL only resolves a NEW.field when that branch runs.
create or replace function public.tg_broadcast_member_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member  uuid;
  v_payload jsonb := jsonb_build_object('kind', tg_argv[0]);
begin
  if tg_table_name = 'turns' then
    v_member := new.owner_id;
    v_payload := v_payload || jsonb_build_object('turn', new.id);
  elsif tg_table_name = 'profiles' then
    v_member := new.id;
  else
    v_member := new.member_id;
  end if;

  if v_member is not null then
    perform realtime.send(v_payload, 'progress', 'member:' || v_member::text, true);
  end if;
  return null;
end;
$$;

-- Trigger functions can't be called directly, but they are revoked like
-- every other internal function here (see function-grant notes in
-- 20260830 migrations): `from public` alone leaves anon/authenticated.
revoke all on function public.tg_broadcast_member_progress() from public, anon, authenticated;

-- ─── When ──────────────────────────────────────────────────────────
-- UPDATE only, and only when the watched column really changed. A row's
-- first state (an insert) is read by the client's own first status check,
-- which runs as soon as it starts waiting.
create trigger broadcast_cv_status
  after update of status on public.cvs
  for each row
  when (old.status is distinct from new.status)
  execute function public.tg_broadcast_member_progress('cv');

create trigger broadcast_cv_suggestions
  after update of cv_suggested_skill_ids on public.profiles
  for each row
  when (old.cv_suggested_skill_ids is distinct from new.cv_suggested_skill_ids)
  execute function public.tg_broadcast_member_progress('cv_suggestions');

create trigger broadcast_github_status
  after update of scan_status on public.github_connections
  for each row
  when (old.scan_status is distinct from new.scan_status)
  execute function public.tg_broadcast_member_progress('github');

-- revision is bumped on every visible lifecycle change of a turn (stage,
-- status, outcome, cancel), and the client's ETag is the revision too.
create trigger broadcast_ai_turn
  after update of revision on ai_private.turns
  for each row
  when (old.revision is distinct from new.revision)
  execute function public.tg_broadcast_member_progress('ai_turn');
