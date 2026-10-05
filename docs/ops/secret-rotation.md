# Secret rotation runbook

Every secret Foundry holds, where each copy lives, what it reaches and how to rotate it without
breaking the other end. The incident plan (`docs/compliance/05-data-breach-incident-response-plan.md`
§4) points here.

Written 2026-10-05 (D5) from the code: every non-public env var read by `frontend/src` and
`server/app`. If you add a secret, add a row.

## Rules

- **Rotate on suspicion, not proof.** The order below is by blast radius.
- **Paired secrets change at both ends in one sitting.** In the gap one side refuses the
  other. Each row says which side to change first so the gap fails safe.
- **Vercel picks up env changes only on a redeploy.** Every Vercel row ends with "redeploy".
- **Afterwards:** prove the old value is dead (it gets refused), then note the time in the
  incident log.
- **Before launch, rotate everything once (E2/E3).** Development values have passed through
  laptops, terminals and CI logs. A launch with fresh keys is also the dry run of this runbook.

## Inventory

| # | Secret | Lives in | Reaches | Rotate |
| --- | --- | --- | --- | --- |
| 1 | Worker `DATABASE_URL` password (`postgres` role today; `cv_worker` after F25) | Worker VM `/etc/foundry/worker.env` | **The whole database**, bypassing RLS | Supabase → Database → reset password. Update `worker.env`, then `systemctl restart 'foundry-worker@*'`. The `postgres` reset also breaks anything else on that password (only the worker). After F25, rotate `cv_worker` with `alter role … password`. |
| 2 | `SUPABASE_SERVICE_ROLE_KEY` | Vercel | Every table, bypassing RLS | Supabase → Settings → API (rotate keys). Update Vercel; redeploy. |
| 3 | Supabase JWT signing key | Supabase | Forging any member's session | Supabase → Auth → Signing keys: add new, make it current, revoke old after 1 h (the access-token lifetime). Members stay signed in through the overlap. |
| 4 | `AZURE_CLIENT_SECRET` (+ client id) | Vercel | Signing read URLs for **every CV and avatar** (Blob Data Reader) | Entra ID → app registration → new client secret. Update Vercel; redeploy; delete the old secret. The gateway uses managed identity and holds no key. |
| 5 | `GITHUB_TOKEN_ENCRYPTION_KEY` | Vercel and the worker `worker.env` (must match) | Decrypting members' stored GitHub OAuth tokens | **Not a plain swap:** tokens encrypted under the old key become unreadable. Either re-encrypt in SQL (`pgp_sym_encrypt(pgp_sym_decrypt(col, old), new)` in one transaction, then switch both envs), or accept that members reconnect GitHub. If the key leaked, also revoke the GitHub OAuth app's tokens (row 8). |
| 6 | `UPLOAD_TICKET_SECRET` | Vercel and the gateway `gateway.env` (must match) | Minting upload tickets | Change the gateway first, then Vercel and redeploy. Uploads fail for the minutes between; there's no data risk. |
| 7 | `GATEWAY_SERVICE_TOKEN` / `SERVICE_TOKEN` | Vercel and the gateway `gateway.env` | Gateway admin calls (blob deletion) | Same order as row 6. The `drain-blob-deletions` cron retries, so nothing is lost. |
| 8 | `GITHUB_OAUTH_CLIENT_SECRET` | Vercel and `worker.env` | Acting as the Foundry GitHub app | GitHub → app settings → generate a new secret; update both; redeploy; delete the old one. |
| 9 | `OPENAI_API_KEY` | `worker.env` (and the ACA executor after A0) | Spending on the OpenAI project | OpenAI → project keys → create, swap, revoke. Check the usage page for spend while exposed. |
| 10 | `RESEND_API_KEY` | Vercel | Sending mail as `mail.` (phishing risk) | Resend → API keys → create, swap, redeploy, delete the old one. Check Resend's log for sends you don't recognise. |
| 11 | `CRON_SECRET` | Vercel **and** `app_config.cron_secret` (pg_cron sends it) | Triggering crons (mail drain, digest, deletions) | `update public.app_config set value = '<new>' where key = 'cron_secret';` then Vercel and redeploy. Crons in the gap get 403 and retry next tick, and the health check reports them. |
| 12 | `UPSTASH_REDIS_REST_TOKEN` / `UPSTASH_CACHE_REDIS_REST_TOKEN` | Vercel | Rate-limit state and cached reads | Upstash → database → reset token; Vercel; redeploy. Fail-closed buckets refuse during the gap, which is audible. |
| 13 | `TURNSTILE_SECRET_KEY` | Vercel | Passing the CAPTCHA server-side | Cloudflare → Turnstile → rotate secret; Vercel; redeploy. |
| 14 | GHCR pull token | Both VMs `/etc/foundry/ghcr-pull.env` | Pulling the private images | Create a new `read:packages` token, write it to both files, revoke the old one. |
| 15 | Sentry DSN / `SENTRY_AUTH_TOKEN` | Vercel, both VMs | Sending junk events / uploading source maps | Sentry → client keys: new DSN, disable the old one. Auth token: revoke and recreate. |

Then, if member sessions may be at risk: **Supabase Auth → sign out all users**. If an admin
account is implicated: reset it, revoke its sessions, and remove its `admins` row.

## Verify each rotation

- **Vercel rows:** after the redeploy, `curl` an endpoint that uses the secret and expect 200. The
  old value must be refused (e.g. `/api/cron/health` with the old bearer → 403).
- **VM rows:** `foundry-release` / `foundry-worker-release` print `FOUNDRY_DEPLOY_OK` only when the
  running container is the requested image. For an env-only change, `systemctl restart` then
  `journalctl -u … -n 20`.
- **Database (row 1):** the worker's next heartbeat appears in Sentry Crons (`cv-worker`).
