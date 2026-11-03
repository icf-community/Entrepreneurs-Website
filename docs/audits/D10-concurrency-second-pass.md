# D10 — Concurrency, second pass: background work versus the member (2026-11-03)

D9 (2026-10-11) covered member-versus-member and admin-versus-admin races. This pass was asked for
before the AI features go to production: **every write path, no gaps.** It found that the weak spot was
not two people at once but **a background job publishing after a slow external call while the member
acts in between.** The AI projection pipeline already did this correctly; the CV and GitHub paths did not.

## Method

1. **Inventory from the live catalogue, not from memory.** 322 application functions in `public` and
   `ai_private`; 164 write; 87 are callable by a signed-in member and none by `anon`; 18 are triggers
   that write. No application function has a second overload (only the vector and citext extension
   ones do), so no stale signature can bypass a check. A first regex missed functions that alias a
   table without `as`; it was widened and the counts above are from the second run.
2. **Hazard scan** over the writers that have no row lock, advisory lock or version check:
   count-then-write, exists-then-write, select-into-then-update, upsert semantics. The body of every
   member-callable hit was read, plus every internal and cron function the scan flagged.
3. **TypeScript** server actions and route handlers (every file with a database call), and the
   Python worker and gateway.
4. **Forced interleavings, red first.** Every finding below has a test that failed against the old
   code for the reason stated, then passed after the fix. Harnesses: `hold_then_race` in
   `server/tests/integration/test_concurrency.py` (first call holds its locks in an open transaction,
   second call runs, first commits), and in `test_worker_races.py` the member's action is injected
   *inside* the stubbed slow call of the real `process_ingest_cv` / `process_scan_github`.

## Findings fixed (migration `20261026000018_concurrency_hardening.sql`, `server/app/worker.py`)

| # | Race | Failed before as | Fix |
|---|---|---|---|
| F1 | Member removes the CV while ingest is in flight; the job finishes and writes the profile, chunks and skills back and marks the removed CV current | `skills from the removed CV came back` | `worker_cv_wanted` is the first statement of the publish transaction and takes the member's CV lock; `remove_my_cv` and `confirm_cv_upload` take the same lock. A removal either happened first (publish aborts) or waits for the publish and then wipes it |
| F2 | Two uploads in flight on different workers; the last to finish becomes current even if older | `a superseded CV paid for an extraction` | Same guard: it is true only while the profile still points at that CV's blob |
| F3 | Disconnect GitHub during a scan: skills deleted, then rewritten by the scan; the tail can also put GitHub text into the summary after the revert | `GitHub skills came back after the member disconnected`, `summary_source = cv_github` | The scan's publish takes the connection row `FOR UPDATE` first and aborts if it is gone; `disconnect_github` now deletes that row first so it waits for a publish in progress; the summary write checks the connection is still `ready` |
| F4 | A finished job run again (worker dies after the publish commits, reaper requeues after 15 minutes) repeats paid extraction, hits unique `cv_profiles.cv_id`, and the dead-letter backstop marks a good CV `failed` | `UniqueViolation cv_profiles_cv_id_key` | Return early when the CV is already `ready` or `flagged` |
| F5 | `issue_upload_ticket` counts open tickets then inserts: a parallel burst passes the 60 cap together | `the second ticket was issued past the cap` | Per-member advisory lock before the count |
| F6 | `report_post` and `report_connection` (10 a day): same shape | `an eleventh report was filed in one day` (both) | Per-member advisory lock before the count |
| F7 | A CV replaced or removed while queued still paid for extraction, and its blob was already queued for deletion so the job could also fail and retry on backoff | `assert 1 == 0` (extract was called) | The same guard runs before the first blob read or provider call; the CV ends `failed` with "Replaced or removed before processing finished." (the dialog reads the newest CV, so a superseded one is never shown) |
| F8 | `admin_set_committee` read the old flag without a lock: a grant and a revoke at once left an admin with the committee flag off | `is_committee=False but admin row present=True` | `select … for update` on the profile read |
| F10 | The page parses a CV after answering, then saves suggested skills with no CV identity: a replaced or removed CV's suggestions overwrote the new CV's or came back | function missing (new signature) | `set_cv_suggested_skills(skills, blob_key default null)` writes only if the key is still the member's CV and parsing is still consented to; the old one-argument function is dropped and a null key keeps the old behaviour for a frontend deployed before the migration |

The worker's slow calls (embeddings for skill matching and chunks) now run **before** the publishing
transaction, so the CV lock is held only for the writes. `supabase/tests/cv_worker_role.sql` runs the
new statements as the least-privilege `cv_worker` login; it cannot read `profiles`, which is why the
check is a `SECURITY DEFINER` function granted to that role only.

## Verified sound (mechanism, and where it is tested)

| Area | Why it holds |
|---|---|
| Connections (send, respond, withdraw, remove, block, report) | Conditional single-statement updates plus per-member advisory locks; `concurrency.spec.ts` |
| Listing submit, approve, reject, edit | Row lock plus `edit_version` compare; poster-versus-admin tested; `test_concurrency.py`, `test_optimistic_edits.py` |
| Posts, likes | Advisory locks per member and per post |
| Upload tickets and avatar/CV confirm | Single `UPDATE … WHERE consumed_at IS NULL` claims the ticket; gateway writes are create-only (`BlobAlreadyExists`) |
| AI executor (`exec_*`) | `exec_turn` row-locks the turn and rejects a stale, expired or mismatched lease; every executor writer calls it; `test_ai_races.py` R1–R15 |
| AI spend | `spend_reserve` advisory lock; release and mark-unknown are `WHERE status = 'reserved'`; R11 |
| AI projections | `worker_put_member_docs` locks the version row and checks version and consent epoch; `worker_put_job_ai` checks `content_version` |
| Cron, purge, expire, enqueue | Atomic statements or advisory lock plus `SKIP LOCKED` plus lease; `test_every_scheduled_sql_job_tolerates_an_overlapping_run` |
| Writing triggers | Job dedupe and pending-listing cap are advisory-locked |
| Bookmark toggle | Tolerates every interleaving (23505 is handled; a double tap is tested) |
| Digests | Advisory lock, `SKIP LOCKED`, 10-minute lease, claim-scoped completion |

## Probes (judged fine by reading, then proven)

- `ai_forget_message` while a turn is running: the turn detaches (`turns.message_id` is `ON DELETE SET NULL`),
  the criteria drop the forgotten message, nothing raises a raw error. `test_ai_races.py`.
- Two overlapping `submit_intake`: both pass the unlocked version check, both apply the member's own
  answers, the end state is version 2 with one completion time. `test_concurrency.py`.

## Accepted, with the reason

- **Last write wins on purpose:** the `set_my_*` member settings and the `admin_set_*` configuration RPCs.
  Low harm, single owner, and optimistic locking would need a "changed elsewhere, reload" path in the UI.
- **`admin_update_listing`:** an admin override; it bumps `edit_version`, so a poster's stale save is
  refused with "changed in another tab".
- **Approve and reject then queue the email in a separate step (F11).** If the server function dies between
  the two, the member is approved with no welcome email. Rare, no harm to the member (they can still
  sign in); fixing it means moving email rendering into SQL. Not a race.
- **`tg_related_edit_version`** updates the parent row after a child row. A direct write to a child table
  racing an RPC on the parent can deadlock; Postgres aborts one side with a retryable error and nothing
  is corrupted.

## Second sweep (migration `20261026000019_second_pass_hardening.sql`, TypeScript, infra)

A read-only agent swept areas this pass had not reached (account deletion, bans, email, blob lifecycle, time
boundaries, retries, caches, AI limits, direct writes, uniqueness). Every claim was re-checked against the
code or the live database before anything was changed; its citations held up. Each fix below has a test that
failed first.

| # | Finding | Fix | Test |
|---|---|---|---|
| A2 | `infra/azure/provision.sh` deleted blobs 30 days after upload in the **avatar and CV containers too**. Uploads are create-only and never rewritten, so every member's live avatar and CV would vanish a month after upload while their profile still pointed at it | The rule covers post images only. **Owner: re-run `provision.sh` and check the live policy with `az storage account management-policy show`** | `server/tests/test_infra_lifecycle.py` fails if another container is added (checked against the old script) |
| A1 | A banned member could delete their account and sign up again with the same Imperial email, auto-approved as a student. The only trace of a deletion was a hash of the old user id | A one-way hash of the email is kept for 12 months when an account with status `rejected` is deleted; signing up with it waits in the normal review queue. Deletion is never refused. Privacy page updated. **Limits:** only the same address (a different email is a different person to this check), and blocks and request cooldowns between two members still reset on deletion | `test_concurrency.py` (banned address not auto-approved; a leaver leaves nothing) |
| A3 | Removing or replacing a CV kept its full text, chunks and embeddings in Postgres forever; the privacy page promised only the file | Removal deletes every CV row; a finished upload deletes the rows it supersedes. The current CV, and the earlier row a hash match reuses, are kept, so re-uploading an identical file still costs nothing. A queued job for a deleted CV stops quietly instead of dead-lettering. Privacy page updated | `test_worker_races.py` (remove, replace, identical re-upload, job for a deleted CV) |
| A4 | `purge_stale_upload_tickets` queued deletions against the post-images default: an orphaned CV was rejected by the gateway and an orphaned avatar 404'd (counted as deleted), so neither was ever removed. A deleted account's open tickets vanished by cascade and queued nothing | A `BEFORE DELETE` trigger on `upload_tickets` queues an unconsumed ticket's blob with the container its purpose names; it covers the purge and the cascade | `test_concurrency.py` |
| A7 | The GitHub callback had no approval check and no rate limit (start has both); its state check only ties the request to a cookie the browser holds. A pending or rejected member could store a token and queue scan jobs | The callback repeats the approval gate. The rate bucket is deliberately not repeated: start already spends it once per connect, and a second spend would halve a legitimate member's attempts | `callback/route.test.ts` (checked red with the gate removed) |
| A5 | `invalidateDirectoryCache` needed only a session and had no limit: one account could loop it to keep the directory cache cold and send every read to Postgres | Approved members and admins only, plus a `directoryRefresh` bucket (10 a minute, fail-open: it protects load, not a boundary) | `profile/actions.test.ts` |
| A6 | The sign-in code limit (10 per 10 minutes) was keyed on the email alone, so anyone could lock a known address out of signing in | Keyed on email **and** caller IP (via the hardened `clientIp`), plus an address-wide ceiling of 100 an hour (`otpVerifyEmail`), spent only after the caller's own bucket passes. Both fail closed | `verifyOtpGate.test.ts` |
| A9 | `create_post` checked approval before its lock, so a post could land just after a ban had purged the author's posts | A share lock on the profile row: a concurrent ban waits for the post and then purges it, or the post is refused | `test_concurrency.py` (ban versus `create_post`) |
| A8 | Events and opportunities could be given a past date by a direct PostgREST update (only the RPCs checked) | Triggers refuse it for members and anonymous callers; RPCs and admin tools are unaffected | `test_concurrency.py` |
| A11 | The core-skill cap (3) counted without a lock | Per-profile advisory lock in the trigger | `test_concurrency.py` |
| A13 | `ai_create_draft_handoff` had no per-member cap behind the app-layer bucket (a direct RPC call bypasses it) | At most 20 live handoffs per member, under a lock | `test_concurrency.py` |
| A14 | The only administrator could delete their own account | Refused when no other administrator exists, under a lock on the roster | `test_concurrency.py` |

**Checked and not a bug.** The opportunity-skill cap (50) looked unlocked but is already serialised: the row-level
edit-version trigger takes the parent opportunity's lock before the statement-level count runs. A test pins it.

**Third sweep: four former accepted risks, fixed (migration `20261026000020_accepted_risk_fixes.sql`).**

| # | Was | Now | Test |
|---|---|---|---|
| R1 | Two administrators deleting each other at once "could leave none" | `admin_delete_user` takes the same roster lock as `delete_my_account` when the target is an administrator, then re-reads the caller's own admin status. **Honest note:** this was not reproducible. The audit-row foreign key already made one side fail (error or deadlock victim), so the old code never emptied the roster in 8 randomised rounds or the forced interleaving; the change makes the refusal clean and ordered, it does not close a live hole | `test_concurrency.py` (both tests also pass on the old code) |
| R2 | A rejected member could still edit their skills and sectors by a direct API write | The write policies refuse a member whose status is `rejected` (pending members keep working, onboarding needs it) | `test_concurrency.py` (failed on the old policy) |
| R3 | An email row that always answered 429 was retried every 30 minutes forever | New `defer_outbound_email`: no attempt is charged for the first day, then each deferral counts and the row is buried at `max_attempts`. Service role only | `test_concurrency.py` (failed first), `drain-email/route.test.ts` |
| R4 | A failed enqueue left the showcase nudge claimed, silencing that member for 30 days | The route releases every claimed member it did not email (new `release_github_showcase_nudges`), and answers 500 on an enqueue failure so the cron run is visible | `test_concurrency.py` (failed first), `github-showcase-nudge/route.test.ts` |

**Still accepted, with the reason.**
- Approve and reject queue their email in a separate step after the decision commits (F11). The realistic failure,
  the queue insert erroring, already reaches Sentry and the admin; only the process dying in that window is uncovered.
- Blocks and request cooldowns between two members reset when either deletes their account, and a banned person
  using a *different* email is a different person to the system. Both are product and privacy decisions (keeping more
  data about deleted people), not defects.
- The AI edit quota is counted over live conversations, so deleting one resets it. A soft guard; draft edits cost nothing.
- A deleted or banned member can linger in the 60 to 300 second directory caches (the TTL is the design).
- `tg_related_edit_version` can deadlock a direct child write against an RPC on the parent; Postgres aborts one side
  with a retryable error and nothing is corrupted.

**Frontend order:** the new drain-email and showcase-nudge routes call `defer_outbound_email` and
`release_github_showcase_nudges`, so deploy the web app only after `…020` is applied.

## Not provable here

Real two-process timing on the production VM, and Upstash (the local tests use a Redis stand-in; the real service is checked after
deploy). **No longer in this list:** the reaper against a genuinely crashed worker. `test_worker_races.py` now starts a real worker
process, SIGKILLs it mid-job, runs the real `reap_stalled_jobs` (it leaves the job alone until it is 15 minutes stale) and
checks the retry publishes once, with one extraction paid.

**Deploy order:** apply the migrations (`…018`, `…019`, `…020`) **before** the new worker image. The new worker calls
`worker_cv_wanted`; the new image on the old database would fail every CV ingest. The migrations alone
are safe with the old worker (the old code never calls the guard, and the new locks only add waiting).
