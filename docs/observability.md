# Observability

Launch programme Part G. Errors and health in production, plus a small trace sample: Sentry's `tracesSampler` (`src/lib/observability/tracesSampler.ts`, 2026-10-26) returns 0.05 for authenticated-route transactions and 0 for everything else, so Web Vitals/performance spans exist only where the auth-latency question actually lives, without materially touching the free tier. Read/write timing otherwise stays a local load-test tool (`PERF_METRICS=1`, E1c). No new SaaS: Sentry, PostHog and our own Postgres.

## G1 · Surfaces and how each is watched

| Surface | Sentry capture | Health / alert |
|---|---|---|
| Server components, route handlers, server actions | Automatic: `onRequestError` in `instrumentation.ts` catches every server-side throw, including every action in `lib/actions/registry.ts`. Handled failures that return `{ok:false}` report explicitly at their choke points (`surface` tag). | New-issue and spike rules |
| Browser | `instrumentation-client.ts` global handlers; the root `error.tsx`, `global-error.tsx` and every segment `error.tsx` (via `SegmentError`) call `captureException` | New-issue and spike rules |
| Edge proxy | `sentry.edge.config.ts` | as above |
| Cron routes (drain-email, drain-blob-deletions, connections-digest, github-showcase-nudge) | Explicit `captureMessage`/`captureException` with `surface: "cron"` | Backlog ages in the health check (below). Per-route check-ins would false-alarm: their pg_cron drivers skip the HTTP call when the queue is empty. |
| Health check `/api/cron/health` | Sentry cron monitor **`app-health`** (every 10 min, created on first check-in) | Missed check-in means pg_cron, pg_net, `app_config`, the secret or Vercel is broken |
| DB-only pg_cron jobs (expire, purge, reap) | none (no route) | `cron_failures` check reads `cron.job_run_details` |
| Upload gateway | `server/app/observability.py` (`component: gateway`) | F-x1 uptime monitor on `/api/health`; gateway liveness via its Docker healthcheck |
| CV/GitHub worker | `server/app/observability.py` (`component: worker`) | Sentry cron monitor **`cv-worker`** (interval 5 min, created on first check-in); `worker_backlog` check |
| AI executor (`python -m app.ai`) | Same module, `component: ai-executor` | Sentry cron monitor **`ai-executor`** (interval 5 min); `ai_queue_age`, `ai_turn_failures`, `ai_unreconciled_24h`, `ai_spend_80pct` checks; per-call trace spans in `ai_private.trace_spans` (G9, metadata only) |
| AI pg_cron jobs (`ai-reap` every minute, `ai-purge` hourly) | none (no route) | `cron_failures` check |

Python privacy settings: `send_default_pii=False`, no request bodies, `include_local_variables=False` (frame locals hold CV text), and a `before_send` scrubber that drops payloads and auth headers, redacts blob keys and truncates long exception text. `server/tests/test_observability.py` pins it.

## G4 · Health checks (`app_health_snapshot()`)

| Check | Fails when |
|---|---|
| `email_backlog` | an outbound email has been due for over 30 min |
| `email_dead_24h` | any email was given up on in the last 24 h |
| `blob_deletion_backlog` | a blob deletion has been due for over 1 h |
| `worker_backlog` | a CV/GitHub job has been due for over 30 min |
| `jobs_dead_24h` | any job went `dead` in the last 24 h |
| `moderation_age` | anything has waited on an admin for over 72 h |
| `cron_failures` | a pg_cron job failed in the last 70 min |
| `cron_http_failures` | a cron HTTP call got a non-2xx, timed out or errored in the last 70 min (wrong secret, apex 307) |
| `config_missing` | a cron driver's `app_config` row is missing (the digest/nudge silent-failure class) |
| `ai_queue_age` | an AI turn has waited over 3 min (the executor isn't claiming) |
| `ai_unreconciled_24h` | a provider call in the last 24 h ended without settled usage (counted at its upper bound) |
| `ai_spend_80pct` | matching, ingestion or controller spend today reached 80% of its daily cap (AI-plan §9 alert) |
| `ai_turn_failures` | at least 5, and over a fifth, of the last hour's AI turns failed (budget and cancellations excluded) |

A failing check is reported as its own Sentry issue (`health: <check>`), on its first failing run and then at most hourly, so an incident can't use up the quota.

## G5 · Alert rules (owner, Sentry dashboard)

All alerts go by email to the owner only. Every rule filters out `synthetic:true`.

1. A new issue in any project goes to email.
2. A regression (a resolved issue that comes back) goes to email.
3. More than 50 events in 10 minutes on one issue goes to email.
4. Cron monitors `app-health`, `cv-worker` and `ai-executor`: a missed or failed check-in goes to email. They appear after their first check-in in prod.
5. Uptime (F-x1): `https://www.imperialentrepreneurs.com/api/health` every 1 min; 2 consecutive failures go to email.
6. Turn on spike protection, and check the plan quotas (D8).

## G6 · Releases and environments

- Frontend events carry `VERCEL_ENV` (production / preview / development). The client uses `NEXT_PUBLIC_VERCEL_ENV`, which Vercel exposes automatically.
- Frontend releases and source maps come from the Sentry build plugin. **Owner:** confirm `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` in Vercel, then throw one test error in prod and check the stack trace is readable.
- Gateway and worker: the image is built with `--build-arg GIT_SHA`, so `SENTRY_RELEASE` is the commit the GHCR tag names. `SENTRY_ENVIRONMENT` defaults to `production`.

## G7 · PostHog event taxonomy

Properties are enums or booleans only: never PII, never another member's id, never search criteria or scores.

| Event | Properties | Where |
|---|---|---|
| `$pageview`, `$pageleave` | automatic | every page |
| `onboarding_completed`, `intake_completed` | none | onboarding, intake |
| `listing_submitted`, `listing_edited` | `kind` | listing forms |
| `listing_expand`, `listing_apply_click`, `listing_contact_click`, `listing_external_click` | `kind`, listing `id` (a listing, not a person) | listing cards |
| `post_created` | none | community |
| `connection_request_sent` | `with_note` | Connect control |
| `connection_accepted`, `connection_declined` | none | Connections |
| `notifications_marked_read` | none | /notifications |
| `data_export_downloaded` | none | Settings |
| `site_banner_published` | `severity` | /admin/banner |
| `site_banner_cleared` | none | /admin/banner |
| `ai_search_submitted` | `mode`, `kind` (message, run, confirm, rescan) | /foundry-ai |
| `ai_search_refused` | `mode`, `kind`, `stage` (admission) | /foundry-ai |
| `ai_search_finished` | `mode`, `status`, `results` (none, few, many) | /foundry-ai |

**Owner, PostHog dashboards:**
- a signup → onboarding_completed → intake_completed funnel;
- weekly active members;
- Connections activity (sent / accepted / declined);
- AI usage by mode, once A1 ships.

`before_send` (`lib/observability/analyticsUrls.ts`) strips the conversation and job ids from `/foundry-ai` URLs, keeping only the mode (F19). Turn ids never appear in a URL or an event.

Admin moderation decisions are deliberately **not** PostHog events. Every one is already written to `admin_actions` in our own database, with who decided, what and when. Queue age is also watched by `moderation_age`. Query that table instead of duplicating it.

## G8 · Test traffic

`lib/observability/synthetic.ts` treats `*.invalid` (the E3 manifest domain `@loadtest.foundry.invalid`) and `@resend.dev` as synthetic.
- **PostHog:** such an account is opted out before `identify`, so its id is never sent. Anonymous pageviews before sign-in carry no identity. k6 runs no browser JS, so it sends nothing.
- **Sentry:** such an account's events carry `synthetic=true`, both client-side and from the page guard. Alert rules ignore that tag; E5 reviews those events by hand.
