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

## Status at 12 Nov 2026 (end of launch day)

Phases 0–3 done: release live (70 migrations, merge commit `fbac651`), prod smoke 19/19, counts and grants match the baseline.
Phase 4–5 results:

| Step | Result |
|---|---|
| 4.1–4.5, 4.7 | Done. Vault is `icf-foundry-ai-kv` (not the script default `foundry-ai-kv`, which belongs to someone else). |
| 4.6 | Done. Workers run as `cv_worker` (session pooler user `cv_worker.<ref>`). A real CV processed on it. Old login kept in `/etc/foundry/worker.env.bak-20261112` on the worker VM until the Phase 7 clean-up. |
| 4.8 | **Polling fallback, not realtime.** Joining the private channel fails with `MissingPartition: Realtime was unable to find the expected messages partition`, although `realtime.messages` has contiguous daily partitions covering today and our one policy is correct. Supabase ticket filed 12 Nov (replies go to imperial.founders@gmail.com). The app falls back to the old poller by design and retries once per wait, so it self-heals when Supabase fixes it. Re-test: DevTools → Network → Socket filter, upload a CV, expect a row with status 101. |
| 5.1 | Done. |
| 5.2 | Done after a fix. The executor's check-ins were rejected because `scrub` redacted the 32-hex `trace_id` to `[hex]` (PR #118). `production` is green on the `ai-executor` monitor. The `probe-*` environments from debugging are stale and can be deleted. The web scrubber (`frontend/src/lib/observability/scrubEvent.ts`) has the same hex rule and still needs the same exemption. |
| 5.3 | Done. `main-protection` requires 13 checks. |
| 5.4 | Not rehearsed. Prerequisites checked: the previous gateway image `4246ac6…` exists in GHCR and the procedure is in `infra/README.md`. |
| 5.5 | Done. All AI flags off. |

## Phase 6 — Go-live (separate decision)

**Gate: these owner-only items must be done before ANY AI flag is turned on** (they do not block Phases 0–5):
OpenAI data region and DPA with the transfer mechanism; lawful basis (consent for discoverability; legitimate interests
plus a balancing test for a member's own matching); `/ai-notice` wording sign-off; DPIA sign-off. Also decide
owner-decisions item 21 (the strict protected-characteristic screen) and confirm the item-20 spend caps.

Gate status, 12 Nov 2026: **cleared** — Sentry monitoring of the executor (5.2), flags verified off (5.5), prices confirmed (4.1), OpenAI DPA in force by incorporation.
**Still open (owner decisions or actions):** swap the vault key for a service-account key (Phase 7 below, must precede any flag); OpenAI data-residency stance (both projects are Global today); lawful basis and balancing test; `/ai-notice` wording; DPIA; items 20 and 21; the capped live smoke below.

1. Capped live smoke (executor, small spend cap).
2. Flip **one** mode in `/admin/ai`, smoke it, watch Sentry and spend, then the next. Flags are the rollback.

## Phase 7 — Afterwards

- After 24 h clean: `rm -rf backups/<UTC>` (the dump contains auth tokens). Keep the old `cv_worker` DSN until then.
- Full Playwright pass against prod to find flaws (owner plan), on own/test accounts only.
- Docs: tick the Sentry EU and Supabase London items in `docs/compliance/03-third-party-dpa-register.md`; also record OpenAI as "DPA in force by incorporation into the Services Agreement (12 Nov 2026)", and add the `foundry-ai` GHCR pull credential to `docs/ops/secret-rotation.md`.
- **Replace the temporary GHCR pull token before it expires (30 days from creation, so by about 12 Dec 2026):** the `foundry-ai` container app pulls its private image with a `read:packages` token from the owner's personal GitHub account (named `foundry-ai-pull-TEMP`). When the society account has org access: (1) create a `read:packages`-only token on the society account; (2) `az containerapp registry set -g foundry-rg -n foundry-ai --server ghcr.io --username <society-account> --password <token>`; (3) confirm the app is still healthy; (4) delete the personal token on GitHub. Do the same for the gateway and worker VMs' `/etc/foundry/ghcr-pull.env` so nothing depends on a personal login.
- **Replace the existing VM pull token `foundry-gateway-ghcr-pull`** (a `read:packages` token on the owner's personal GitHub account, expires **31 Aug 2027**, used by both VMs): create a `read:packages`-only token on the society account, write it to `/etc/foundry/ghcr-pull.env` on **both** VMs (gateway and worker; `GHCR_USERNAME` and `GHCR_TOKEN`), confirm each VM can still pull by running its release script against the current image (`foundry-release` / `foundry-worker-release`), then delete the personal token on GitHub. Do this together with the `foundry-ai` token above so one account change covers all three. The 2027 expiry is a hard deadline either way: if it lapses, both VMs fail to pull on their next deploy or restart. Longer term, consider Azure Container Registry with a managed identity, which removes the token entirely.
- **Replace the person-owned OpenAI key in the vault with a service-account key:** `ai-openai-api-key` in `icf-foundry-ai-kv` holds the key named "Azure key" (ends `dLsA`, created 11 Nov 2026 by the society president's OpenAI account). A key tied to a person can stop working if that person leaves the organisation. In the AI executor's OpenAI project, create a **service account**, give it a restricted key (Responses/Chat and Embeddings only), set it with `az keyvault secret set --vault-name icf-foundry-ai-kv --name ai-openai-api-key --value ...` (use `read -s`; add `--query id -o tsv` so the value is not echoed), restart the `foundry-ai` revision, confirm the "AI executor starting" log line, then delete the old key. Also confirm the key's project is the AI executor's, not the CV pipeline's. Must be done before any AI flag is turned on in Phase 6.
- Delete `/etc/foundry/worker.env.bak-20261112` on the worker VM after 24 h clean (it holds the old superuser login).
- Sentry tidy-up: delete the `probe-a` to `probe-g` environments from the `ai-executor` monitor; archive `elm.events.push is not a function` in `javascript-nextjs` (browser-extension noise, 0 users); exempt trace/span ids in `scrubEvent.ts`.
- Check for Supabase's reply on the Realtime `MissingPartition` ticket; once fixed, re-test 4.8.
- Sign the OpenAI DPA form (the "Execute Data Processing Agreement" link on openai.com/policies/data-processing-addendum) for a countersigned copy, within a week.

## Rollback summary

| Layer | Rollback |
|---|---|
| Frontend | Roll **forward** (a Vercel rollback restores the old frontend on the new schema) |
| Gateway / worker | Previous GHCR digest via the release scripts |
| Executor | Flags off; previous image digest |
| Migrations | Never destructive; fix forward. Restore from backup only for data damage |
