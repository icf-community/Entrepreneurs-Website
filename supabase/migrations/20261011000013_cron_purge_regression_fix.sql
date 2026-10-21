-- Fixes a regression introduced by migration 20261011000012. That
-- migration recreated ai_private.cron_purge() to add the draft_handoffs
-- purge, but was built from the wrong base (20261006000004's original
-- body) instead of the latest one (20261011000008's, which had already
-- added the admission_refusals and poll_counts purges for S3). The two
-- lines were silently dropped — found during a full-codebase audit, not
-- by a test, which is itself the finding: there is no test that catches
-- "a recreated function quietly lost a line a previous migration added".
-- (poll_counts is written on every ai_turn_status call, so this was a
-- real unbounded-growth bug, not a cosmetic one.)
create or replace function ai_private.cron_purge()
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  delete from ai_private.admission_refusals where hour < now() - interval '14 days';
  delete from ai_private.poll_counts where hour < now() - interval '14 days';
  delete from ai_private.messages where expires_at <= now();
  delete from ai_private.turns where expires_at <= now();
  delete from ai_private.saved_scans where expires_at <= now();
  -- A conversation with no live message and nothing running is gone; one
  -- that still has live messages keeps only criteria whose sources live.
  delete from ai_private.conversations c
   where c.last_activity_at < now() - interval '168 hours'
     and not exists (select 1 from ai_private.messages m where m.conversation_id = c.id)
     and not exists (select 1 from ai_private.turns t where t.conversation_id = c.id);
  update ai_private.conversations c
     set spec = ai_private.effective_spec(c.spec), spec_revision = c.spec_revision + 1,
         prev_spec = case when c.prev_spec is null then null else ai_private.effective_spec(c.prev_spec) end
   where jsonb_array_length(c.spec->'atoms') <> jsonb_array_length(ai_private.effective_spec(c.spec)->'atoms')
     and not exists (select 1 from ai_private.turns t where t.conversation_id = c.id and t.status in ('queued', 'running'));
  delete from ai_private.assessments where expires_at <= now();
  delete from ai_private.query_embeddings where expires_at <= now();
  delete from ai_private.trace_spans where turn_id is null and created_at < now() - interval '7 days';
  delete from ai_private.usage_events where created_at < now() - interval '25 hours';
  delete from ai_private.surfaced_members where surfaced_at < now() - interval '25 hours';
  delete from ai_private.draft_handoffs where created_at < now() - interval '1 hour';
end;
$$;
revoke all on function ai_private.cron_purge() from public;
