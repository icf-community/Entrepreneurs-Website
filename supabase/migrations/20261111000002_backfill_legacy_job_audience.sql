-- ════════════════════════════════════════════════════════════════════
-- Foundry · Existing jobs keep being visible after the audience cutover
--
-- 20261006000002 added opportunities.eligible_audience with NULL meaning
-- "needs review", and every read now filters on it. NULL admits no
-- audience, so every job posted before that migration would have vanished
-- from members' boards on release day until an admin opened and re-saved
-- each one, and the admin side shows only a count of such jobs, not a
-- list.
--
-- Before the cutover every job was open to everyone, which is 'both'.
-- Backfilling that keeps today's behaviour for jobs that already exist.
-- New and edited jobs still have to choose (assert_audience is unchanged).
--
-- Owner decision, 2026-11-11. The member side of F29 is unchanged: a member
-- with no education status still sees no audience-restricted job until
-- they answer.
--
-- Side effects, all intended: updated_at moves, and audience_version is
-- bumped by tg_opportunity_versions, which queues the AI job-doc refresh
-- these jobs need anyway. status is untouched, so no notification,
-- system post or status-protection trigger fires.
-- ════════════════════════════════════════════════════════════════════

update public.opportunities
   set eligible_audience = 'both'
 where eligible_audience is null;
