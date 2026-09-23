# Launch capacity and Connections verification

Audit date: 2026-09-23. Target: approximately 2,000 members, at least 500 concurrent users.

**Decision: production capacity is not signed off.** Connections' core workflows pass local correctness tests, but neither the older audits nor this local run proves that the deployed Supabase Free project can sustain 500 active users. Do not equate registered users, browser sessions, HTTP requests, Realtime sockets, pooler clients and active database connections.

No environment files or existing environment-variable values were inspected. Builds/tests ran from a source copy under `/tmp/foundry-scale-audit`, excluding environment files, with an explicitly constructed environment and Supabase's public local-development signing secret. Email, Azure, Upstash, telemetry and other remote credentials were absent. No deployment or production load test was performed. Graphify's existing graph was used for navigation; source and executable tests were used to verify its claims.

The graph was refreshed with explicit environment-file exclusions after code changes. Refresh used AST extraction with no LLM/API token charge; full assistant token consumption was not measured. Semantic community labels were not regenerated.

## Evidence from this run

| Check | Result and boundary |
| --- | --- |
| Local schema | All migrations through `20260917000015`; initially 5,006 profiles and 248,445 connection rows |
| Frontend unit tests | 357 passed in 40 files, including two new Azure concurrency/recovery tests |
| Load-response regression tests | 3 passed: real pages, streamed redirects, streamed/transport failures |
| Python backend | 202 passed; one dependency deprecation warning |
| Lint and production build | Passed after correcting the unsupported `PAGE_SIZE` export; webpack build used for the temporary source copy |
| Connections browser suite | All 13 passed against a fresh build, including two independent member sessions, reporting/admin handling, graph keyboard access, graph payload privacy and settings |
| SQL suites | `rls_smoke`, `adversarial_edges`, `admission_roles`, `verify_prod_schema` passed locally |
| Concurrent database writes | 20 simultaneous sends by one new approved member: 10 succeeded, 10 refused with SQLSTATE 42501; precisely 10 rows persisted. Two simultaneous reciprocal sends: both succeeded and produced one accepted pair. Temporary accounts/events removed afterward |
| Scale query harness | Completed after fixing its single-member deletion fixture; all mutations rolled back |
| Operational capacity SQL | New aggregate-only, read-only check executed successfully locally |

The SQL suites assume a clean fixture population. The existing scale corpus initially broke an exact pending-member count assertion. For this audit only, the existing synthetic-corpus cleanup was inserted **inside each test transaction**, with its commit removed; rollback restored the corpus. The database was not reset. The schema verifier emitted its expected local warning that `connections_digest_url` is absent. This warning must not be accepted in production.

Browser tests originally assumed a fixture was on the directory's first page and that a second digest invocation had no other recipients to process. Both assumptions fail with thousands of members. The tests now search for their member, page the admin user lookup, place their own digest fixture at the front of the queue, and verify recipient-specific idempotency under genuinely overlapping cron calls. Cron tests enqueue synthetic local mail; they do not test delivery by the email provider.

## Authenticated HTTP load: failed locally

The controlled rerun used the fresh production build, two seconds of think time **after each page**, a 20-second ramp, a 60-second plateau and a ten-second ramp-down, with k6's graceful completion window. Every one of the 20 synthetic identities passed an authenticated `/home` preflight before each completed stage. Requests used isolated cookie jars. The 500 VUs reused those 20 identities; this is not a 500-distinct-member simulation.

| Target VUs | Page requests (excluding preflight) | Failed page checks | Auth redirects, including streamed 200s | Gate |
| ---: | ---: | ---: | ---: | --- |
| 100 | 3,465 | 33.59% | 1,164 | Failed |
| 500 | 7,579 | 84.79% | 6,426 | Failed |

At 500 VUs every measured route also breached the five-second p95 threshold. **Do not quote those latency numbers as successful authenticated page-render latency:** the samples include redirects. Both completed stages exited 99 because the checks/thresholds failed. The subsequent controlled 750-VU stage refused to start because the session lifetime was insufficient; it supplies no additional capacity evidence. Earlier exploratory 100/250/500/750 runs also failed, but lacked the all-identity preflight and are not the controlled results above.

The Next.js log recorded many `UND_ERR_SOCKET` / `fetch failed` errors calling localhost Supabase, including data reads. The guard redirects when it cannot obtain a user/profile, so infrastructure trouble can masquerade as being signed out; data helpers can also render empty lists after a failed RPC. Three synthetic sessions checked directly against Auth after the first load sequence were still valid. This is **a failing local integration under load**, not proof that the credentials were simply wrong and not proof of PostgreSQL pool exhaustion. Isolating the precise failing layer requires time-correlated Auth/PostgREST/Kong/Next.js and database telemetry.

Recovery was verified after removing load and minting fresh synthetic sessions: all 20 identities passed preflight, then a one-VU run completed 108 page checks with zero failures/redirects and a worst route p95 of approximately 213 ms. No local service restart was needed. This proves low-load recovery, not sustained capacity.

The local DB allows **300 connections**, and Docker has a substantially larger memory budget than Free Nano. Redis caching/rate limiting, Azure signing, provider delivery and browser effects were not present. A laptop's single Next.js process, local service proxies and k6 compete for the same resources. These differences prevent transferring either failure percentages or throughput to production. They do not justify ignoring the failures or claiming that 500 users are supported.

The sanitized metric artifact is [2026-09-23-local-load.json](results/2026-09-23-local-load.json). Raw diagnostic logs remain under `/tmp/foundry-load-*`; they are temporary local artifacts, not deployment telemetry.

For a prepared, isolated test environment, the revised harness accepts:

```sh
MODE=auth STAGE=500 HOLD_SECONDS=600 THINK_SECONDS=2 P95_MS=5000 \
  BASE=http://127.0.0.1:3100 k6 run frontend/scripts/loadtest.js
```

Mint fresh local synthetic sessions with the existing mint helper first. Its session file is deliberately ignored by git. `GATE=0` is exploratory only; `THINK_SECONDS=0` is an explicit stress test. Neither option can be used to claim a realistic browsing release gate passed. A staging deployment needs its own synthetic session provisioning rather than pointing the local-only mint helper at production.

## What pooling means for this application

The browser and Next.js use `supabase-js` over HTTPS to Auth and the Data API. PostgREST maintains database connections for those requests. Creating a request-scoped SSR client does **not** open a dedicated PostgreSQL connection per visitor. No application Realtime subscriptions were found, so the Free plan's 200 Realtime connection allowance is not the current browser-session ceiling.

The Python ingestion worker is the direct PostgreSQL client (`server/app/db.py`). Each worker opens and closes connections around transactions; worker count matters here. The runbook records three workers, but deployed process count and actual connection mode were not independently inspected in this audit. The upload HTTP gateway deliberately has no database connection.

The Free Nano defaults are 60 direct database connections and 200 pooler clients. These are different resources; neither is a 60-user or 200-user site limit. The services share database capacity. Changing the Supavisor pool size does not enlarge PostgREST's throughput or the machine's CPU/RAM. Supabase advises caution allocating more than 40% of DB connections to Supavisor when the Data API is heavily used. Sources: [connection limits](https://supabase.com/docs/guides/troubleshooting/how-to-change-max-database-connections-_BQ8P5), [connection management](https://supabase.com/docs/guides/database/connection-management), [PostgREST pooling](https://postgrest.org/en/stable/references/connection_pool.html).

For intuition, 500 visitors loading one page every ten seconds generate approximately 50 page requests/second, before assets, navigation prefetch and polling. A simultaneous click by all 500 is a different workload. A Connections render includes the proxy's Auth lookup, another Auth lookup in the page guard, the guard's admin/profile reads and the selected tab's queries. Requests per second and database time per query determine pressure; user count alone cannot.

The migration playbook's claim that 60 connections alone proves that 1,000 signed-in users cannot work is too strong. Its conclusion that capacity remains unverified is correct. Migrating to Azure/Clerk is not a prerequisite to pooling the current HTTP application; it introduces a new authorization and pooling implementation that would itself need verification.

## Measured SQL costs and storage

One local scale-harness pass against the existing approximately 5,000-member / 248,000-edge corpus:

| Connections operation | Local execution time |
| --- | ---: |
| First card page for the hub | 5.27 ms |
| Deep keyset page | 5.42 ms |
| Pending badge | 0.39 ms |
| State with another member | 0.57 ms |
| Facets for the hub | 52.19 ms |
| Graph payload | 14.41 ms |
| Send with database gates | 5.35 ms |
| Empty-member list | 0.69 ms |
| Digest claim, 200 requests | 155.16 ms |
| Block | 1.53 ms |

These are diagnostic single-call measurements on a shared laptop, not an isolated CPU benchmark, concurrent production latency or a guarantee of index use inside a SECURITY DEFINER wrapper. Earlier C3/C5 audits contain the underlying plan investigations. Counts and facets still scale with a member's degree; keyset pagination does not make every part of the page constant-time. The graph is capped at 500 nodes and the normal card page at 48. The unshipped two-hop mutual query is not part of the capacity claim.

The local database measured approximately 456–458 MiB during the audit. Its largest relations were `cv_chunks` (~156 MiB including indexes), `connections` (~98 MiB), `connection_events` (~86 MiB) and synthetic `cv_skills` (~65 MiB). This is a stress fixture with test history/bloat, **not production usage and not a projection for exactly 2,000 members**. The older pre-index 189 MB figure is not the current corpus's storage requirement.

Supabase Free includes a 500 MB database quota, 50,000 monthly active users, 1 GB Storage and 5 GB egress. The database quota can trigger read-only mode. MAU is not the concern at 2,000 members; storage growth and shared compute are. Images, avatars and CV files currently use **Azure Blob**, not Supabase Storage, while vectors/metadata remain in Postgres. Sources: [billing allowances](https://supabase.com/docs/guides/platform/billing-on-supabase), [database size and read-only mode](https://supabase.com/docs/guides/platform/database-size).

## Confirmed delivery bottleneck: Connections digests

`claim_connection_digests(200)` limits **request rows before grouping**, and the route runs once daily. It is not 200 complete recipient inboxes. A local rollback-only probe measured:

| Eligible requests before claim | Eligible recipients | Requests claimed | Recipients returned |
| ---: | ---: | ---: | ---: |
| 7,253 | 3,649 | 200 | 196 |

With no new traffic, that backlog needs at least 37 daily executions. Even 2,000 requests need at least ten. One recipient's requests can be split across days. The route also intentionally claims before enqueueing: a process crash/enqueue failure can lose a digest permanently. Overlapping claims do not duplicate the same request; that is not exactly-once delivery of email.

**Still open:** implement a bounded, restartable recipient-level outbox/scheduler that drains the expected daily volume, aggregates each recipient's daily digest, and coordinates provider quota. Merely looping the current RPC can split a recipient into several emails. Merely increasing a page-size constant does not establish reliable delivery. Keep the current product behavior explicit until this is implemented; the audit corrected misleading comments but did not silently redesign mail semantics or scheduling.

The general outbox drains 20 messages every five minutes: at most 240/hour or 5,760/day before failures and provider caps. Resend Free permits only 100/day and 3,000/month. If auth SMTP shares the provider account, digest/acceptance mail can consume the same allowance needed by OTPs; asynchronous queueing isolates latency, not provider quota. Actual provider plan and SMTP configuration remain unverified. Source: [Resend pricing](https://resend.com/pricing).

## Other launch constraints

| Surface | Finding | Required action |
| --- | --- | --- |
| Authentication | Production SMTP/provider and rate settings are not known. Supabase's built-in mail service has a very low default allowance; campus users share an IP. Local config sets sign-in/signup and verification buckets to 30 per five minutes | Confirm custom SMTP, provider quota and live Auth limits. Test a campus-NAT login/OTP burst separately; pre-minted sessions deliberately bypass login |
| Frontend | Public marketing/legal routes are now static, but authenticated pages render per request. Older audit advice to remove root `force-dynamic` is historical | Verify actual Vercel tier, function metrics and region proximity to Supabase. Do not extrapolate one local process to Vercel scaling |
| Cache/rate limits | Dedicated-cache variables fall back to the rate-limit Redis. Cached reads consume quota; cache misses can fan out to Supabase | Verify separate databases and current quotas in the dashboard. Test warm, cold and unavailable Redis paths in staging; do not share private member results globally |
| Uploads | Gateway has two workers; per-IP nginx guard allows 10 requests/second with burst 300 | Test actual image/CV uploads and CPU/memory, including a shared-IP burst. 500 simultaneous uploads exceed the configured immediate burst budget; general page viewing is a different path |
| Background work | Workers use a bounded queue and separate VM. Prior 500-job benchmark mocked AI latency and did not test real provider RPM/TPM | Monitor queue age, failures, provider rate limits and recovery; worker count alone does not establish provider throughput |
| Browser polling | CV and GitHub dialogs poll every two seconds while visible. Their `setInterval` callbacks can overlap on slow requests | At 500 visible processing dialogs, one poll per dialog adds about 250 status calls/second, plus auth/server-action work. Introduce backoff/jitter and non-overlap before bulk onboarding; measure this workload separately |
| Read failure visibility | Shared data helpers log RPC errors but return empty lists/nulls | A 200 page can still contain missing data. Load acceptance requires server/database error monitoring and seeded-result assertions, not HTTP success alone |
| Retention | Connection/event retention is bounded and cron-based | Verify all migrations, schedules, successful runs and queue ages on the deployed DB. A registered cron is not proof of successful delivery |

Auth limits source: [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits). Dashboard checks require no disclosure of environment values.

## Changes made during this audit

- Azure delegation-key refresh now shares one in-flight fetch per process across concurrent image/CV renders, with recovery after failure. Tests cover 100 simultaneous image renders plus a CV, cache expiry and a failed refresh. This reduces a cold-start request stampede; it is not a cross-instance distributed cache.
- `/connections` joins the explicit `no-store` route list and surge-runbook exclusions. It contains private addresses and must not be made publicly cacheable to solve load.
- The unused export of `PAGE_SIZE` from the admin page was removed because the fresh Next.js production build rejected it.
- The query-plan harness now clears an isolated member's non-cascading listing references inside a savepoint, then restores them. Previously a valid scale fixture aborted the remainder of the benchmark.
- Connections browser fixtures work with a populated directory and exercise truly overlapping digest calls.
- The load harness checks rendered content and streamed redirects/errors, adds browsing pauses, validates parameters and session lifetime, writes a JSON summary, and uses failing exit-status thresholds. It no longer asserts that HTTP-only requests exercise client-side badge effects.
- `supabase/checks/launch_capacity.sql` provides a read-only snapshot without exposing addresses, query text, app-config values or credentials.

## Launch gate

I recommend moving off Supabase Free before this launch for database headroom and backups, **without claiming that a paid plan automatically passes the load target**. Pro starts at $25/month and includes $10 compute credit; Micro has 1 GB RAM and still 60 direct connections. Small has 2 GB RAM and 90 direct connections, approximately $30/month total for one project with that credit before tax/overages. Pro + Small is a reasonable staging starting point, with final sizing determined by measurements. Confirm compute explicitly after upgrading: existing Nano compute is not necessarily upgraded automatically. Sources: [pricing](https://supabase.com/pricing), [compute](https://supabase.com/docs/guides/platform/compute-and-disk).

Before launch:

1. Put the intended build/schema on staging with representative member, connection and embedding data, deployed compute, regions, caching and rate limits. Complete C4's production migration/config/cron/handshake checklist when shipping.
2. Run 100 → 250 → 500 → 750 **authenticated** users, not a mixed 500-VU test with only 250 signed in. Use unique sessions where possible, realistic think time, a ten-minute hold at 500 and a longer soak; follow with a synchronized burst.
3. Require zero hard/semantic failures, no unexpected 429s, per-route p95 below 5 seconds, stable memory, database/pool headroom and no accumulating queue. Capture p99 and errors as well as averages. These are proposed release thresholds, not a vendor guarantee.
4. Exercise onboarding/login, uploads, browser polling, the badge, write bursts and concurrent account actions separately; k6 HTTP page GETs do not cover them. Check server logs for swallowed data-read failures.
5. Verify backup restore, actual DB usage/egress, provider quotas, Redis isolation and alerts. Test recovery after the burst, not just survival during it.
6. Fix the digest-capacity issue before promising next-day notification to a launch-sized audience. Verify actual delivered mail in a controlled test.

Do not run the 500/750-user harness against the live site as a substitute for staging, and do not interpret edge-blocked requests as origin capacity evidence. The historical production test mostly received 429s and never answered the origin-capacity question.

The feature's technical handshake is verified locally. Whether it creates useful real-world introductions cannot be learned from synthetic tests; monitor aggregate request-to-accept conversion, time to acceptance and report/block rates after launch.
