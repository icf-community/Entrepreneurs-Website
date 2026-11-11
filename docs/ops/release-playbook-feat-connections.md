# Release playbook — `feat/connections` batch to production

Owner-run, in order. **[YOU]** = a dashboard or terminal action only the owner does. **[CLAUDE]** = read-only
checking from the repo or local stack. Nothing here is run against prod by Claude. Never source `.env.local` (it is PROD).

**Stop rules.** A red CI check, a dry-run that does not list exactly the expected migrations, or any step whose
verification does not match: stop, paste the output, do not continue. The AI feature flags stay **off** until Phase 6.

## The release-order hazard (read first)

Merging to `main` starts three things at once:

1. Vercel builds the frontend (production deploy).
2. `deploy-gateway.yml` (any change under `server/**`, which this batch has) builds and ships the gateway to its VM.
3. `deploy-worker.yml` does the same for the CV worker VM.

Both VM workflows run in `environment: production`. So the merge must not be allowed to put the new frontend or the new
worker in front of the old schema. This playbook handles it by:

- **Vercel:** auto-assign OFF, so the merge builds a *Staged* deployment that gets no traffic until we Promote it.
- **GitHub `production` environment:** required reviewer, so each VM deploy waits for approval. Gateway is approved
  first (B21: the gateway that accepts `aud`/`iss` must be live before the frontend that mints them). The worker is
  approved only after `db push`.

Four functions are NOT backward-compatible with the old frontend (`submit_opportunity`, `admin_create_opportunity`,
`update_opportunity` need `p_eligible_audience`; `confirm_github_connected` needs `p_member_id`). Posting/editing jobs
and connecting GitHub fail between `db push` and Promote, so those two are run back to back. Rollback of this release is
**roll-forward only** (a Vercel rollback restores the old frontend onto the new schema).

---

## Phase 0 — Prerequisites (before merging; the PR can be open meanwhile)

| # | Who | Step | Pass when |
|---|---|---|---|
| 0.1 | YOU | Pick a quiet window (~54 members; avoid campus peak hours). Allow ~90 min. | Time agreed |
| 0.2 | YOU | Vercel → Settings → Advanced: Skew Protection ON ("Enable access to System Environment Variables" ticked). | Shows enabled |
| 0.3 | YOU | Vercel → Settings → Environments → Production → Branch Tracking: **auto-assign OFF** (turn back ON in 3.5). | Shows off |
| 0.4 | YOU | GitHub → repo Settings → Environments → `production` → **Required reviewers = you**. | Saved |
| 0.5 | YOU | Confirm `foundry-release.sh` is on the gateway VM and `foundry-worker-release.sh` on the worker VM (the workflows run them via `az vm run-command`). | Both present, current |
| 0.6 | YOU | Prod SQL editor, read-only: `select proname, pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='realtime'::regnamespace and proname='send';` and `select polname from pg_policy where polrelid='realtime.messages'::regclass;` | One `send` row; no policy named `member receives own progress signals` |
| 0.7 | YOU | Prod SQL editor: run `supabase/snippets/preflight_release_constraints.sql`. | Every part-1 row `0`; part 2 shows the jobs count (1 on 2026-11-11) and approved non-admin members (~52) |
| 0.8 | YOU | `supabase db push --dry-run --db-url "$BACKUP_DB_URL"` | Exactly **70** migrations, last two `20261111000001_progress_broadcasts` and `20261111000002_backfill_legacy_job_audience` |
| 0.9 | YOU | Accept the one OpenAI call that is **not** behind an AI flag: the backfill bumps `audience_version` on the existing job, which queues `refresh_job_ai`; once the worker is deployed it embeds that approved job's text (identifiers stripped by `privacy.minimise`) through the worker's existing OpenAI key, the same project the CV pipeline already uses. Members' own data is only embedded after they opt in to discoverability, which needs the flags. | You accept it, or hold Phase 3.4 until the OpenAI DPA is signed |

## Phase 1 — PR and CI

| # | Who | Step | Pass when |
|---|---|---|---|
| 1.1 | CLAUDE | Open the PR `feat/connections` → `main`, release order in the description. | PR exists |
| 1.2 | YOU | Wait for **every** CI job green (full CI, nothing path-filtered). The flaky Supabase CLI rate-limit failure is cleared by a re-run; any other failure is new. | All green |
| 1.3 | YOU + CLAUDE | Skim the PR "Files changed" for anything unexpected (e.g. a stray `review_sheet.csv`). | Nothing unexpected |

## Phase 2 — Fresh backup, then merge

| # | Who | Step | Pass when |
|---|---|---|---|
| 2.1 | YOU | `scripts/db-backup.sh` (needs `BACKUP_DB_URL`). The 2026-11-11 06:19 backup is stale. | New `backups/<UTC>/` with `roles.sql`, `schema.sql`, `data.sql` |
| 2.2 | YOU | Merge the PR. | Merged |
| 2.3 | YOU | Vercel: the production build is *Staged* (not live). Wait for **Ready**. | Staged + Ready; the live site still shows the old frontend |
| 2.4 | YOU | GitHub Actions: approve **Deploy gateway only**. Leave Deploy worker waiting. | Workflow green, its health/sentinel step passes |
| 2.5 | YOU | Verify the running gateway digest equals the one just built (not just "CI green"). | Digests match |

## Phase 3 — Database push and Promote (back to back)

| # | Who | Step | Pass when |
|---|---|---|---|
| 3.1 | YOU | Re-run the dry-run (0.8). | Still exactly 70 |
| 3.2 | YOU | `supabase db push --db-url "$BACKUP_DB_URL"` | Applies 70 migrations, no error |
| 3.3 | YOU | **Immediately** Promote the Staged deployment (Deployments → ⋯ → Promote, or `vercel promote <url>`). | Live site serves the new build |
| 3.4 | YOU | Approve **Deploy worker**. Verify its running digest. | Green, digest matches |
| 3.5 | YOU | Vercel: auto-assign back ON. | Shows on |
| 3.6 | YOU | `supabase migration list --db-url "$BACKUP_DB_URL"` | Local and remote columns identical |
| 3.7 | YOU | Prod SQL: `select count(*) from public.opportunities where eligible_audience is null;` | `0` |
| 3.8 | YOU | Prod SQL: re-run the 2026-11-11 count query (profiles, opportunities, events, connections, posts, admin_actions). | Same as before, plus any genuine new sign-ups |
| 3.9 | YOU | Prod SQL: `supabase/checks/grant_dump.sql`; compare to the local dump (`docs/verification/local-schema.json`, `scripts/audit-local-schema.py`). Claude diffs it. | No difference |
| 3.10 | YOU | `PROD_BASE_URL=https://www.imperialentrepreneurs.com node scripts/prod-smoke.mjs` | All routes pass |
| 3.11 | YOU | Sign in as yourself: a job is visible; the education-status prompt appears for a non-admin test view. | As expected |

**If 3.2 fails partway:** do NOT Promote. Paste the output. Each migration is its own transaction, so the DB is at a
known migration. The old frontend stays live; the four breaking functions are the only exposure and they only matter once
the failing migration is one of those. Restore from the Phase 2 backup only if data was damaged (it is not expected).

## Phase 4 — AI configuration (flags still OFF)

| # | Who | Step | Pass when |
|---|---|---|---|
| 4.1 | YOU | Confirm prices (the three values are verified against OpenAI's page on 2026-11-11):<br>`update ai_private.model_prices m set input_micro_per_mtok=v.i, output_micro_per_mtok=v.o, price_version=m.price_version+1, confirmed=true from (values ('gpt-5.4-mini',750000,4500000),('gpt-6.1-sol',2000000,10000000),('text-embedding-3-small',20000,0)) as v(model,i,o) where m.model=v.model;`<br>then `select model, confirmed from ai_private.model_prices;` | 3 rows updated; all `confirmed = true` |
| 4.2 | YOU | Add the `health_url` `app_config` row (one-row insert; never re-run the full seed snippet, it can overwrite secrets). Check `connections_digest_url` already exists. | Both rows present |
| 4.3 | YOU | Generate an `ai_service` password (`openssl rand -base64 24 \| tr -d '/+='`), `alter role ai_service password '…'` in the SQL editor. | No error |
| 4.4 | YOU | Put the real DSN in the vault: `az keyvault secret set --vault-name icf-foundry-ai-kv --name ai-database-url --value 'postgresql://ai_service.jnoinwpgqkqgrijbxbvk:<password>@aws-1-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require'`. Never paste the password in chat. | Secret saved |
| 4.5 | YOU | Restart the container-app revision (secrets are read at revision start): `az containerapp revision list` then `az containerapp revision restart`. | New revision healthy |
| 4.6 | YOU | `cv_worker`: set a password, switch the worker's DSN (keep the old one for rollback), restart workers, watch the `cv-worker` heartbeat. | Heartbeat steady |
| 4.7 | YOU | Re-check the Azure blob lifecycle policy (concurrency audit D10). | Policy as intended |
| 4.8 | YOU | Own-account realtime check on prod: start a CV scan or GitHub scan and watch progress arrive without the status RPC being polled (browser network tab). | Progress updates; polling stops |

## Phase 5 — AI executor, still flags off

| # | Who | Step | Pass when |
|---|---|---|---|
| 5.1 | YOU | GitHub → Settings → Variables: `AZURE_AI_APP_NAME=foundry-ai`. Run **Deploy AI executor** (manual; it runs `pytest -q` and `python -m evals run` first). | Green; running digest matches |
| 5.2 | YOU | Sentry: the `ai-executor` cron monitor checks in. | Check-ins arriving |
| 5.3 | YOU | Add "AI executor (docker build + scan)" as a required check on `main`. | Listed as required |
| 5.4 | YOU | Rehearse a rollback of the gateway and worker to the previous GHCR digest. | Both come back healthy |
| 5.5 | YOU | Verify the production `ai_*` flags read off in `/admin/ai`. | All off |

## Phase 6 — Go-live (separate decision)

**Gate: these owner-only items must be done before ANY AI flag is turned on** (they do not block Phases 0–5):
OpenAI data region and DPA with the transfer mechanism; lawful basis (consent for discoverability; legitimate interests
plus a balancing test for a member's own matching); `/ai-notice` wording sign-off; DPIA sign-off. Also decide
owner-decisions item 21 (the strict protected-characteristic screen) and confirm the item-20 spend caps.

1. Capped live smoke (executor, small spend cap).
2. Flip **one** mode in `/admin/ai`, smoke it, watch Sentry and spend, then the next. Flags are the rollback.

## Phase 7 — Afterwards

- After 24 h clean: `rm -rf backups/<UTC>` (the dump contains auth tokens). Keep the old `cv_worker` DSN until then.
- Full Playwright pass against prod to find flaws (owner plan), on own/test accounts only.
- Docs: tick the Sentry EU and Supabase London items in `docs/compliance/03-third-party-dpa-register.md`.

## Rollback summary

| Layer | Rollback |
|---|---|
| Frontend | Roll **forward** (a Vercel rollback restores the old frontend on the new schema) |
| Gateway / worker | Previous GHCR digest via the release scripts |
| Executor | Flags off; previous image digest |
| Migrations | Never destructive; fix forward. Restore from backup only for data damage |
