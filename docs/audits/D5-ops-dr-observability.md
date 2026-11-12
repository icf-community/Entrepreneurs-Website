# D5 — Ops, disaster recovery and observability

Audit date: 2026-10-05. Branch `feat/connections`. The repository and the local stack; every
production action is an owner step.

**Gate (programme Part D):** restore rehearsed, and rollback rehearsed once per component.

**Result:**
- **Restore:** rehearsed locally (B16).
- **Rollback:** the gateway and worker rollback path was broken; fixed and documented. The
  per-component rehearsals on production hosts are owner steps in E2/E3, listed below.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| D5-F1 | **High** | **A gateway or worker rollback reported success while the bad build kept running.** The systemd units run `${GATEWAY_IMAGE}`, set to `:latest`, and re-pull it on every start. `foundry-release <older ref>` pulled the older image, restarted, passed the health check on the **current** `:latest`, and printed `FOUNDRY_DEPLOY_OK <older ref>`. The worker script did the same. It's the 2026-09-14 "green ≠ running" class again, on the path you reach for during an incident. Normal deploys were correct only because CI pushes each build as `:latest` first. | Fixed: both release scripts compare the image ID of each running container with the requested ref, and fail with instructions if they differ. Verified with a throwaway container: the matching ID passes and a different tag is caught. `infra/README.md` now has a **Rollback** section: retag the good SHA as `:latest` in GHCR (or dispatch the deploy workflow at that commit), then release. **Owner (E2):** copy both scripts to `/usr/local/sbin/` on their VMs. |
| D5-F2 | Medium | **The rotation runbook covered 8 secrets and missed the most dangerous ones:** the worker's database password (whole DB), the Vercel Azure principal (signs read URLs for every CV), the GitHub token encryption key (rotating it orphans every stored token unless re-encrypted), the gateway's paired secrets, the OpenAI, Turnstile and GitHub OAuth secrets, the cache Upstash, the GHCR pull token, and the `app_config.cron_secret` copy. | New `docs/ops/secret-rotation.md`: all 15 secrets, every location, blast radius, the safe order for paired secrets, and how to verify. Incident plan §4 points to it. **Dry run (local):** `CRON_SECRET` rotated across the app env and `app_config`. Before: old → 200, new → 403. After: old → 403, new → 200, row matching. **Recommendation:** rotate everything once before launch (E2/E3); dev values have passed through laptops and CI logs. |

## Component status

| Area | State | Evidence or owner step |
| --- | --- | --- |
| Sentry: Next.js client, server and edge | Errors only, `tracesSampleRate: 0`, environment tag | G6 |
| Sentry: gateway and worker | `server/app/observability.py` (no PII, bodies or locals) | G2, `test_observability.py` |
| Missed-run alerts | `app-health` (10 min), `cv-worker` heartbeat (5 min) | G3 |
| Backlog and stuck-job alerts | `app_health_snapshot()`: 9 checks | G4. **Owner:** `health_url` row after `db push` |
| Alert rules → owner email, spike protection | Not configured | **Owner (G5)** |
| Readable prod stack traces | Not verified | **Owner (G6):** Sentry env vars in Vercel, plus one test error |
| Uptime | Not configured | **Owner (F-x1):** Sentry Uptime on `/api/health` |
| Backups | `scripts/db-backup.sh` (session pooler `db dump`) | B16 |
| Restore | `scripts/db-restore-rehearsal.sh`: dump → reset local → load → `verify_prod_schema` + row counts | B16 (local). **Owner (E1a):** Pro backup → restore into a throwaway project |
| Rollback: Vercel | Instant rollback (promote the previous deployment) | **Owner (E2):** rehearse once on the first prod deploy of this branch |
| Rollback: gateway and worker | Fixed (D5-F1) | **Owner (E2/E3):** one rehearsal per VM using the new Rollback section |
| Rollback: database | Forward-only. 20260928000009–11 are additive or replace-in-place: two RPC rewrites, one index, and an FK loosened from RESTRICT to SET NULL. The old frontend keeps working on the new schema. | Reviewed here |
| Running-container check | Release scripts now verify image IDs (D5-F1) | — |
| Incident plan | `docs/compliance/05-…`, rotation now complete | **Owner + committee:** a 30-minute tabletop (e.g. "service_role key pasted in a public channel") before E5b |
| PostHog privacy (F19) | URL sanitiser and AI events | Lands with A1 |

## Open

- **Owner:** G5, G6, F-x1, E1a restore, the Vercel and VM rollback rehearsals, installing the
  updated release scripts, the tabletop, and the pre-launch secret rotation.
- **Rotation dry run:** the prod-side half (`app_config` via pg_cron) is exercised by the
  pre-launch rotation.
