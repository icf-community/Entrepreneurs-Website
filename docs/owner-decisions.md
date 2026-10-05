# Owner decisions and steps (parked until the code is finished)

Saved 2026-10-06. The owner reviews these once the AI build (A0–A3) and the full local test pass
are done, before the release PR. Each item names where the detail lives. Nothing here is done by
Claude: these are dashboard settings, legal wording, spend, or production steps.

## Urgent

1. **Privacy page vs CV processing (F15, D6-1).** The page says extracted CV text is never stored or
   sent to a third party. The worker stores it and sends it to OpenAI. **Keep CV/GitHub ingestion
   switched off in prod** (admin → ingestion kill switch, `github_cv_ingestion_enabled`) until the
   page is reworded. Detail: `docs/audits/D6-privacy-compliance.md`.

## Decisions

2. **Processor register and controller sign-off (D6).** Add OpenAI, Azure and GitHub to the
   processor register, ROPA and privacy page. Retention lines for failed mail (30 d), notifications
   (90 d), the admin audit log, the email-change log and listing views. Decide the export additions
   (own `admin_actions`, own `connection_events`, `cv_profiles.summary`). Record sign-off in
   `docs/compliance/README.md`.
3. **Admin audit log after an admin deletes their account (D3).** Keep an identity snapshot ("who")
   or not. If yes, it needs a privacy-page/ROPA line.
4. **Budget (D8).** Confirm the marked prices, pick the VM option (B-series quota / one VM / 1-year
   reservation), set the AI daily cap, approve the table. Detail: `docs/audits/D8-cost.md`.
5. **AI (A0.2, before any AI flag goes on).** DPIA, consent wording, discovery/evidence rules,
   `/ai-notice` copy. Detail: `AI-plan.md` §13–14.

## Dashboard and production steps

6. **Supabase:** turn on asymmetric JWT signing keys (Auth → Signing keys). Without them the
   `getClaims()` speed-up silently falls back to `getUser()`.
7. **GitHub:** protect `main` with the 9 required checks in `docs/audits/D7-supply-chain-ci.md`.
8. **`cv_worker` login (F25), after `supabase db push`:** set its password, confirm the session
   pooler accepts `cv_worker.<ref>`, switch `/etc/foundry/worker.env` `DATABASE_URL` (keep the old
   DSN for rollback), restart the workers, watch the `cv-worker` heartbeat.
9. **VMs:** copy the updated release scripts (`infra/vm/foundry-release.sh`,
   `foundry-worker-release.sh`) to `/usr/local/sbin` on both VMs; rehearse one rollback each.
10. **Secrets:** rotate all 15 once before launch (`docs/ops/secret-rotation.md`).
11. **Spend alerts at 80%:** Azure, Supabase, Vercel, OpenAI, Upstash, Resend, Sentry spike
    protection (D8 table).
12. **Monitoring:** Sentry alert rules (G5), uptime monitor on `/api/health` (F-x1), source-map
    env vars plus one prod test error with a readable trace (G6). Detail: `docs/observability.md`.

## Also on the list (from `tasks/todo.md`)

- Live grant dump in prod after db push, diffed against local (`supabase/checks/grant_dump.sql`).
- `health_url` row in `app_config` after db push (G4).
- E3 load-test think time (2 s is a coin toss on Medium; 5 s passes comfortably).
- Resend Pro, then `digest_daily_cap` → 800 and Auth emails/hour ≥ 1000.
- Vercel plan (Pro before the E3 window).
- Supabase Auth: CAPTCHA toggle, per-IP limits 500 per 5 min, OTP length 6 + templates.
- Separate Upstash database for Vercel Preview (B15).
- Screenshot review (D4) and VoiceOver on phones (E5b).
- AI prerequisites: a separate OpenAI project/key for matching, Azure Container Apps environment,
  Key Vault, registry identity, live-eval cost ceiling.
