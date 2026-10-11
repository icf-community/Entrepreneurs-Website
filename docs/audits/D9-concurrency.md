# D9 — Concurrency and races, whole app (2026-10-11)

Scope: every write path, meaning SQL functions, direct table writes from server actions, scheduled
jobs, background-job enqueues and the read-through cache, checked for what happens when two of them
run at the same time. AI-specific races are in `docs/ai-build.md` (S1).

## Method

1. **Static scan.** The latest definition of each of the 297 functions in `supabase/migrations/` was
   extracted, including every `$tag$` quoting style. A first pass that only matched `$$` missed
   `$function$` bodies, and the scan was re-run. Flagged: any function that reads (a count,
   `exists`, `select … into`) and then writes, with no row lock, advisory lock, upsert or
   `skip locked`. **50 flagged.** Each was read line by line.
2. **Frontend writes.** Every `.insert/.update/.upsert/.delete` on a table outside an RPC.
3. **Forced interleaving, not luck.**
   - `server/tests/integration/test_concurrency.py` runs the first call in a transaction that does
     its write and stays open, holding its locks, while the second call runs, then commits.
   - Under READ COMMITTED, a check-then-write function does the wrong thing in this harness every
     time.
   - Every test below was run against the old definitions first and failed; the outcomes are
     listed in the Fixes table.
4. **Schema scan** for a related class found on the way: CHECK constraints that require a column
   whose foreign key is `ON DELETE SET NULL`.

## Fixes (migration `20261011000001_concurrency_fixes.sql`)

| Path | What went wrong at the same time | Fix | Test |
|---|---|---|---|
| `approve_*` / `reject_*` (event, opportunity, VC/grant) | Two admins deciding one listing: both succeeded. The poster got both emails, and the final state was whichever committed last | `select … for update` before the pending check | `test_approve_and_reject_of_one_listing_cannot_both_succeed` ×3 |
| `approve_user` / `reject_user` | An applicant approved, then deleted as "rejected" by a second admin | Row lock on the profile in both | `test_approve_and_reject_of_one_member_cannot_both_succeed` |
| `admin_resolve_post_report` | Resolved twice, two audit rows, reporter emailed twice | Row lock | `test_a_post_report_is_resolved_once` |
| `admin_delete_post` | Two moderation-log rows, author emailed twice | Row lock | `test_a_post_is_removed_once` |
| `admin_delete_user` | Second delete still returned the email (second "deleted" email) and audited twice | Lock the `auth.users` row | `test_an_account_is_deleted_once` |
| `confirm_cv_upload`, `confirm_avatar_upload` | One ticket confirmed twice: **two cvs rows and two paid ingestion jobs** | Claim the ticket in one conditional `UPDATE … where consumed_at is null` | `test_an_upload_ticket_is_consumed_once`, `…avatar…` |
| `create_post` | Double click on a slow connection posted twice; the duplicate check missed overlapping requests | Per-member transaction advisory lock | `test_a_double_submitted_post_is_posted_once` |
| `toggle_post_like` | Double tap raised a raw unique violation | Per-member-per-post advisory lock | `test_concurrent_like_toggles_never_error` |
| `update_opportunity`, `update_event`, `update_vc_grant` | **An edit racing approval went live unreviewed**: it read `pending`, then wrote onto the now-approved listing | Lock the listing before reading its status, so the edit is staged for review | `test_an_edit_racing_approval_goes_through_review` ×3 |
| Job enqueues (`refresh_member_ai`, `refresh_job_ai`, `refresh_github_summary`, `scan_github`) | "Queue unless one is pending" used `not exists`; two overlapping enqueues both queued a paid job | One `BEFORE INSERT` trigger on `jobs`: an advisory lock per kind and target, then the check on a fresh snapshot. Covers SQL and worker enqueuers alike | `test_job_enqueue_dedupe_holds_under_concurrency`, `test_ai_refresh_enqueue_dedupe_holds_under_concurrency` |
| `due_github_showcase_nudges` | Two overlapping runs (cron plus a manual run, or a retried invocation) emailed the same members twice | Claims while reading (`for update skip locked` plus the stamp in one statement) | `test_overlapping_nudge_runs_claim_disjoint_members` |
| `purge_stale_upload_tickets` | Two overlapping runs queued every abandoned blob twice | Delete first, queue what was deleted | `test_overlapping_ticket_purges_queue_each_blob_once` |
| Approval and resolution metadata (opportunities, events, vcs_grants, post_reports, connection_reports) | **An admin who had approved a listing or resolved a report could not delete their account** (or be deleted): `approved_by`/`resolved_by` are `ON DELETE SET NULL` and a CHECK required them | CHECKs keep `approved_at`/`resolved_at` and drop the decider requirement | `rls_smoke` S0 (deletion plus a schema scan), `verify_prod_schema` check 9 |

Outside the migration:

| Path | Problem | Fix | Test |
|---|---|---|---|
| `toggleOpportunityBookmark` (server action) | Check-then-insert; a tap from another tab gave the loser an error toast | Treat 23505 on insert as success (the bookmark exists) | `src/app/opportunities/actions.test.ts` |
| `lib/cache.ts` | A load that started before a write stored the old value after the write's `invalidate()`, pinning stale data for the TTL | `invalidate()` bumps a per-key generation; write-back is a Lua compare-and-set on it | `cache.test.ts` "S0: races…" |
| `lib/cache.ts` (slow keys) | Every Vercel instance missing at once ran the facets query (the slowest directory read) in parallel | `SET NX` fill lock for `directoryFacets`; others wait up to ~600 ms for the holder's value, then load anyway | same |
| `ai_service`, `cv_worker` logins | No statement/lock/idle timeouts: a stuck transaction held locks and a pooler slot indefinitely | `20261011000002` (15 s/3 s/30 s and 60 s/5 s/60 s); checked by `verify_prod_schema` check 8 | `test_a_blocked_executor_call_times_out_instead_of_hanging` (hangs past 9 s without the setting; fails fast with it) |

## Already safe (read, not changed)

- **Connections:** `send_connection_request` retries on the pair unique index and decides with
  conditional updates. `respond_to_connection_request`, `remove_connection` and
  `expire_connection_requests` use conditional updates. Quotas take
  `pg_advisory_xact_lock('connection_send:' || caller)` in `connection_assert_can_send`.
- **Listing-edit queue:** `stage_listing_edit` upserts on the pending edit;
  `admin_apply/reject_listing_edit` lock the edit row (`for update`).
- **Outbox, blob deletions, digests, stalled jobs:** claimed with `for update skip locked` (and a
  lease for digests).
- **Expiry and purge crons:** single set-based statements with status predicates.
  `test_every_scheduled_sql_job_tolerates_an_overlapping_run` runs all 14 SQL cron jobs twice at once.
- **Idempotent by construction:** `submit_intake`, `submit_onboarding`, `defer_intake`,
  `set_my_affiliation`, `remove_my_cv`, `update_cv_currency`, `delete_my_post`,
  `complete_connection_digests` (conditional on the claim id).
- **AI:** admission, claim and reserve are serialised (`ai_submit_member`, `ai_submit_queue`,
  `ai_claim` and spend advisory locks; 2026-10-06). `bump_member_source` is incidentally
  serialised by its upsert; the enqueue trigger now makes that explicit.

## Accepted, with the reason

- **`admin_create_event` / `admin_create_vc_grant` double submit** creates two listings. Admin-only,
  the form disables while pending, and a duplicate is visible and deletable. An idempotency key
  isn't worth its cost here.
- **`issue_upload_ticket`'s 60-outstanding cap** can be passed by a few under concurrency. It is a
  loop backstop; the per-member rate limit is the control.
- **Lost update from two tabs of one member** (profile save, pending-listing edit) is
  last-write-wins. It only ever affects one member's own edits. A guard on `profiles.updated_at`
  would wrongly refuse saves after a CV or photo upload on the same page. A correct guard needs a
  dedicated edit counter and a signature change across four forms. Owner can ask for it.
- **E2E leaves `revoke_github_token` jobs** in the local database. Local only; prod has no E2E.

## Still to do in S0 (tracked in tasks/todo.md)

Latency injection (Toxiproxy) with the double-submit pass on every mutating control; DB CPU per
request down to ≤ 4.5 ms; `supabase/checks/invariants.sql` after a mixed read/write k6 run.
