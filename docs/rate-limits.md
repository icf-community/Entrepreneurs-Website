# Rate limits and caps, everything in one place

Compiled 2026-11-08 from the code and the local database (which reflects the latest migration of every
function). Numbers are what the repo enforces. Anything configured outside the repo is listed at the end
under "Not knowable from the repo", and those values must be read off the dashboards.

**Reading the tables.** "Key" is what the limit counts against. Account-keyed limits are per person;
IP-keyed ones are per building on campus, because Imperial students share one public IP.
"Fail" says what happens if the limiter itself is down: *closed* = refuse, *open* = allow. Closed buckets
fall back to a per-instance in-memory limiter with the same numbers, not a hard refusal.

## 1. App layer (Next.js, Upstash Redis): `frontend/src/lib/ratelimit.ts`

Sliding windows. Redis keys are prefixed `rl:`, with a `preview:`/`dev:` segment outside production.

| Bucket | Limit | Key | Fail | Used for |
|---|---|---|---|---|
| `mutations` | 60 / min | user id | open | backstop on every signed-in non-GET request (all server actions) |
| `anonMutations` | 1200 / min | client IP | open | backstop on anonymous non-GET (signup waves; a campus-wide flood guard, not per person) |
| `submit` | 10 / hour | user id, else IP | closed | contact form, listing and event submissions |
| `communityPost` | 10 / day | user id | closed | creating a community post |
| `communityUpload` | 40 / day | user id | closed | community image upload tickets |
| `postReport` | 5 / day | user id | closed | reporting a post or a connection |
| `avatarUpload` | 10 / day | user id | closed | avatar upload tickets |
| `cvUpload` | 5 / day | user id | closed | CV upload tickets |
| `githubConnect` | 3 / day | user id | closed | starting the GitHub OAuth connect |
| `githubShowcase` | 10 / hour | user id | closed | saving GitHub showcase picks |
| `connectionRequest` | 15 / day | user id | closed | sending a connection request |
| `connectionRespond` | 100 / day | user id | closed | accept, decline, withdraw, remove, block, unblock |
| `listingEdit` | 20 / hour | user id | closed | editing your own listing |
| `listingEditNotify` | 1 / 15 min | listing id | open | admin notification when a live listing is edited |
| `dataExport` | 5 / day | user id | closed | "download my data" |
| `otpVerify` | 10 / 10 min | email + IP | closed | typed 6-digit sign-in code |
| `otpVerifyEmail` | 100 / hour | email | closed | same, per email regardless of IP (campus NAT-safe) |
| `directoryRefresh` | 10 / min | user id | closed | refreshing the member directory cache |
| `aiSubmit` | 10 / min | user id | closed | submitting an AI turn |
| `aiEdit` | 30 / min | user id | open | editing AI criteria |
| `aiRead` | 60 / min | user id | open | reading AI turn state |
| `aiReportMatch` | 5 / day | user id | closed | reporting an AI match |
| `aiDraftHandoff` | 20 / hour | user id | open | saving AI filters as a draft |

GET and HEAD requests are never rate limited by the app. Reads are Cloudflare's job.

## 2. Database layer (enforced inside RPCs, cannot be bypassed from the client)

| Limit | Value | Where |
|---|---|---|
| Community posts | 15 / rolling 24 h per member, and an identical title+body is refused for 24 h | `create_post` |
| Post likes | 200 / hour per member | `toggle_post_like` |
| Unconsumed upload tickets | 60 open at once per member (all purposes) | `issue_upload_ticket` |
| Post images | 2 per post | `create_post` |
| GitHub showcase picks | 3 repos | `set_my_github_showcase` |
| Notifications mark-read batch | 100 ids | `mark_notifications_read` |
| **Connections** (`app_config.connection_limits`, admin-tunable) | | |
| ...requests sent | 10 / day, 25 / week, 30 outstanding | `connection_assert_can_send` |
| ...throttled senders | 3 / day for 30 days, after 5 distinct signals in 90 days | same |
| ...cooldown after a decline/remove/block | 21 days, sender only | `block_member` and friends |
| ...blocks | 20 / day | `connection_limits.block_daily_cap` |
| ...request expiry | 6 months | cron |
| ...note length | 300 characters | |
| ...digest email | at most 1 per 20 h per member, 40 recipients / day (`digest_daily_cap`) | `claim_connection_digests` |
| **AI turns** (`ai_submit_turn`) | | |
| ...rate | 5 / minute and 40 / rolling day per member, shared by all modes | |
| ...concurrency | 1 running turn per conversation, 2 per member | |
| ...threads | 5 live conversations per member, 15 turns per conversation | |
| ...rescan (recruiter) | 5 min cooldown, 10 / day per job | |
| ...message length | 600 characters | |
| ...draft handoffs | 20 stored per member | `ai_create_draft_handoff` |
| ...criteria edits | 200 / day per member (one row per day, so deleting a chat cannot reset it) | `ai_private.edit_counter` |
| **AI spend** (`ai_private.settings`, change only via `admin_set_ai_limits`) | | |
| ...per member | $0.50 / day and 200,000 tokens / day | |
| ...matching | $5 / day, $150 / month | |
| ...CV/ingestion | $5 / day total, $0.25 / day per member | |
| ...everything combined (controller) | $20 / day | |
| ...executor capacity | 20 active turns, 40 provider requests, queue of 200, 120 s max wait, 45 s turn deadline, 20 s per attempt | |
| ...caps can only be raised 25% at a time | enforced in `admin_set_ai_limits` | |

Note the two AI rate limiters stack: the app's `aiSubmit` (10 / min) sits in front of the database's 5 / min.
The database one is the stricter, but both produce the same user-facing "a lot of searches" message.

## 3. Background work (cron and batch sizes)

| Job | Rate |
|---|---|
| Outbound email drain | 20 per run, every 5 min, so at most 240 / hour, 5,760 / day |
| Connections digest | every 15 min between 08:00 and 11:59 UTC, 50 per claim |
| GitHub rescans | enqueue hourly, a profile is re-scanned if last scan is over 7 days old |
| GitHub showcase nudge | Mondays 09:30, 50 per run, a member is nudged at most every 30 days |
| Blob deletion drain | 200 per run, every 5 min |
| Stalled job reaper | every 5 min; health check every 10 min; AI reaper every minute |
| Daily expiries and purges | events, opportunities, VCs, connection requests, notifications, tickets, tombstones, between 02:00 and 03:23 |

## 4. Gateway and executor (Python, `server/`)

| Limit | Value |
|---|---|
| nginx flood guard (gateway VM) | 10 requests / s per IP, burst 300, then 429 (`infra/vm/nginx-foundry-gateway.conf`) |
| Upload size | 8 MiB (upload and document), signed into the upload ticket |
| Image processing | 40 megapixels max input, 12,000 px max input edge, output edge 1,600 (avatars 512) |
| Document zip bomb guard | expansion ratio 60, 50 MiB uncompressed (docx) |
| CV text sent to the model | 60,000 characters |
| GitHub scan | 3 pages of repos, 120,000 prompt tokens; GitHub's own rate limit raises a retryable error |
| DELETE body | 64 KiB |
| Page runtime | admin list pages `maxDuration = 60` s; cron routes override the same way |

## 5. Supabase Auth (GoTrue)

Local `supabase/config.toml` values, which are the defaults and are **not** necessarily what production uses:

| Setting | Local value |
|---|---|
| Sign-up and sign-in requests | 30 / 5 min per IP |
| OTP / magic-link verifications | 30 / 5 min per IP |
| Token refreshes | 150 / 5 min per IP |
| Anonymous sign-ins | 30 / hour per IP |
| Emails sent | 2 / hour (a local-only value, production uses Resend custom SMTP) |
| Minimum gap between emails to one address | 1 s signup / 5 s other flows |
| OTP | 6 digits, valid 1,800 s |

## Not knowable from the repo (read these off the dashboards before the prod test)

- **Production Supabase Auth limits.** Dashboard, Auth, Rate Limits. The "emails sent per hour" value
  matters most: with custom SMTP it defaults to 30 / hour unless raised, and every sign-in code is an email.
  The 30-per-5-min-per-IP sign-in limit also applies to a campus NAT, which is a ceiling for a launch-talk
  signup wave. Never load tested.
- **Supabase Medium plan limits** (connections, Kong, egress). The local test found the knee between 200 and
  300 VUs from Kong's connection cap. Read the real numbers off the dashboard.
- **Cloudflare rules.** Whether any rate-limiting rules, Bot Fight Mode or Under Attack Mode are configured on
  the web domain. The code assumes Cloudflare is the flood shield for reads.
- **Resend plan.** Free tier caps (about 100 / day, 3,000 / month) would starve sign-in codes. Memory says to
  raise `digest_daily_cap` only after buying Pro.
- **OpenAI account tier** (requests and tokens per minute) for the interpreter, ingestion and embeddings.
- **Upstash** command quota (now pay-as-you-go, cache and limiter in two databases).
- **Vercel** plan limits (function invocations, concurrency, duration).
- **Cloudflare Turnstile** is not a rate limit, but it gates signup, contact, listing submit and login sends.
