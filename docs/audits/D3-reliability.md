# D3 — Reliability and data correctness

Audit date: 2026-10-05. Branch `feat/connections`. Local stack only.

**Gate (programme Part D):** every drill ends in a visible error with Retry; no silent empties;
no duplicates.

**Result: pass, with one owner decision (D3-F2 option) and two items for the E3 window**
(gateway/worker drills on the real Azure hosts).

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| D3-F1 | **High** | **Saving a profile after a failed read could erase it.** `profileIntakeData` read the member's skills, sectors, interests and intents with `rows()`, which turns a 4xx (a code bug such as a missing grant; outages already throw) into `[]`. The form would show "nothing selected", and every save goes through `_apply_intake_fields`, which **deletes and re-inserts** all four sets, so saving erased them. The same applied to an opportunity's tags on its edit page. | Fixed: the three prefill reads use `rowsOrThrow`, so the segment's error page shows with Try again. `src/lib/data/failedReads.test.ts` forces a 403 on every query; it fails on the old loaders (5/5) and passes now. The skills/sectors *catalogue* can still degrade, because the form keeps selected IDs in state and a missing catalogue can't drop them. |
| D3-F2 | **Medium** | **Deleting an account erased that person's admin audit trail.** `admin_actions.admin_id` was `ON DELETE RESTRICT`, so `delete_my_account`, `admin_delete_user`, `admin_delete_graduates` and `reject_user` each deleted the person's own `admin_actions` rows first. With every committee member an admin, someone could act and then delete their account, and the record went with it. One admin deleting another erased the other's history the same way. | Fixed by `20260928000011_admin_actions_survive_deletion.sql`: the key is `ON DELETE SET NULL` and the four functions are recreated from their live definitions without the deletes. Actions, targets, reasons and times survive. **Who** did it is lost, since no personal data about the deleted person is kept. `rls_smoke.sql` (D3 block + the graduate test) fails before the migration and passes after. **Owner decision:** whether to also keep a "who" snapshot (e.g. the admin's email) after their account is deleted. It's better for accountability, but it means retaining personal data after an erasure request, which needs a line in the privacy notice and ROPA (D6). |
| D3-F3 | **Medium** | **A stalled Supabase held some pages for ~100 s instead of failing.** Live drill: with PostgREST paused, `/profile` didn't render its error within 60 s. `AbortSignal.timeout()` rejects with a `TimeoutError`, and postgrest-js retries an idempotent GET on any fetch error except `AbortError` (3 more attempts, 1/2/4 s backoff). So every table select waited four 25 s timeouts plus backoff, beyond any function limit. RPC pages (POST) weren't affected. | Fixed: `fetchWithTimeout` rethrows its own timeout as an `AbortError`, which the libraries already map to "unreachable" (status 0). `src/lib/supabase/unavailable.test.ts` (one attempt, status 0, < 500 ms) fails on the old code. Re-drilled: `/profile` now fails at 25.5 s like every other page. |
| D3-F4 | Low | `drain-email` had only auth tests and `github-showcase-nudge` had none. The send and retry policy was correct but unpinned. | Added tests: sent → `sent_at` + idempotency key = row id; 429 → wait 30 min without burning an attempt; 5xx and network errors → attempt + backoff; 4xx → buried at max attempts. Nudge: auth before DB, enqueue *then* mark, a failed enqueue marks nobody, a failed mark still answers 200. |
| D3-F5 | Low, accepted | Two **overlapping** nudge runs (the cron plus a manual trigger) could both read the due list before either marks it, giving one duplicate lifecycle email. A re-run after completion is safe. | Accepted: weekly, behind a 30-day throttle, and manual runs are rare. The digest, which is frequent, already has a lease (exactly-once, E2E-tested). |
| D3-F6 | Low | Moderation queues (post reports, connection reports, flagged senders) still degraded to empty on a 4xx and would read as "nothing to review" (the B4 class). | Fixed: `rowsOrThrow`, with tests in `failedReads.test.ts`. |

## Live outage drill: Supabase API down

Method:
- A production build on :3100 against local Supabase, signed in as the E2E student.
- `docker pause` on the PostgREST and GoTrue containers (no restart, no kong reload).
- Visit each page, then unpause and press **Try again**.

| | Before the D3-F3 fix | After |
| --- | --- | --- |
| /home, /members, /opportunities, /events, /connections, /community, /notifications | error with Try again at 25.5 s; no empty state; no login bounce | same |
| /profile | **no response within 60 s** | error with Try again at 25.5 s |
| Try again after resume | directory shown | directory shown |

Separately:

| Condition | /members |
| --- | --- |
| **Auth paused** (PostgREST up) | 200 in 64 ms. `getClaims()` verifies locally against the cached JWKS (10-minute in-process cache), so an Auth outage doesn't take signed-in pages down. That's evidence for B26. |
| **PostgREST paused** | 25 s, i.e. one `REQUEST_TIMEOUT_MS`. |

**Tunable, not changed:** the server client's 25 s budget (`lib/supabase/server.ts`). In a full
outage a member waits 25 s for the error page. Lowering it would turn slow-but-successful pages
under heavy load into errors. Revisit with the E3 numbers.

## Other drills (unit-level, already in the suite)

| Failure | Behaviour | Test |
| --- | --- | --- |
| Upstash down | Fail-closed buckets (OTP verify, connection requests, submissions) refuse with "unavailable", not "limited". Fail-open buckets degrade to a local bound. The cache passes through. | `ratelimit.test.ts`, `cache.test.ts` |
| Turnstile siteverify throws | Fails closed | `turnstile.test.ts` |
| Supabase Auth outage in an action | `unreachable`, never a demotion or "signed out" | `actionAuth.test.ts`, `guard.test.ts` |
| Gateway 5xx/404 on blob delete | Retry with backoff; a 404 counts as done; other 4xx buried | `drain-blob-deletions/route.test.ts` |
| GitHub/OpenAI rate limits in the worker | Retryable scan error; dead token not retried | pytest (`test_github_pipeline`, `test_worker`) |
| Gateway or worker host down | — | **E3 window**: the real Azure VMs; the drill needs the deployed topology |

## Idempotency and double submit

- **Database:**
  - unique pairs on connections, bookmarks, likes and listing actions;
  - digest and email claims via `FOR UPDATE SKIP LOCKED` plus a lease;
  - Resend idempotency key = outbox row id;
  - k6 write mix: 0 leftover duplicates after a 0-error run (E1b).
- **UI:** in-flight guards on toggles (B5/B7).
- **New test:** `community.spec.ts`, "a double click on Post creates one post" (passes).
- **Correction:** B6's promised Playwright double-click tests didn't exist. This is the first one.

## Account deletion (F30)

Every foreign key that points at a member, by ON DELETE rule:

| Rule | Keys |
| --- | --- |
| CASCADE | profile data, connections, notifications, posts, likes, bookmarks, CV/GitHub rows, upload tickets |
| SET NULL | approvals, report resolvers and reporters, banner author, and now `admin_actions.admin_id` |
| RESTRICT | `opportunities` / `events` / `vcs_grants.posted_by` only; each delete path removes the member's listings first |

`rls_smoke` exercises self-delete, admin delete and graduate delete with connections and
`admin_actions` present.

## Open

- **Owner:** the D3-F2 decision (keep an identity snapshot in the admin log or not).
- **E3:** gateway and worker outage drills on the deployed hosts.
- **Revisit:** the 25 s request budget, after the E3 load numbers.
