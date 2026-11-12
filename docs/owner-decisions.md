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

## Foundry AI (built locally; nothing switched on)

Detail: [ai-build.md](ai-build.md). In this order:

13. **Existing jobs need an audience before members can see them.** From the db push on, every job is
    for students, graduates or both, and a job without one is hidden from members (admins still see
    it). `/admin/ai` lists them with one-click Students / Graduates / Both.
14. **Members' education status.** Members who haven't answered see a "Confirm your status to see
    jobs" prompt on /opportunities (your F29 decision: enforce immediately). Intake now asks it too.
15. **Confirm model prices** against OpenAI's pricing page and mark them confirmed
    (`ai_private.model_prices`; the SQL is printed by `infra/azure/provision-ai.sh --print-only`). The
    seeded values are pessimistic placeholders; the executor refuses to start until they're confirmed.
    Ingestion keeps working meanwhile and is metered at the placeholder prices.
16. **A separate OpenAI project and key for matching**, with its own spend alert (not the ingestion key).
17. **Azure:** run `infra/azure/provision-ai.sh`, set the three Key Vault secrets and the
    `ai_service` password, set `AZURE_AI_APP_NAME`, then run the "Deploy AI executor" workflow.
18. ~~Make yourself an AI operator~~ — removed 2026-11-10: every admin is automatically an AI
    operator now (`is_ai_operator()` is just `is_admin()`), so no SQL step is needed before handoff.
19. **Legal (A0.2):** wording for `/ai-notice` (factual draft in place), the DPIA, the processor
    register/ROPA lines for OpenAI matching, and the lawful basis per purpose. No flag before sign-off.
20. **Limits:** confirm the starting caps ($5/day matching, $0.50/day per member, 20 active turns) or
    set others in `/admin/ai`.
21. **One product call:** the pre-model screen refuses searches that name a protected characteristic.
    It also refuses "founders building products for women's health" (a domain, not a filter on
    people). Keep it strict, or have it narrowed?
22. **Required checks on `main`:** add "AI executor (docker build + scan)" to the D7 list.
23. **First live smoke:** a small capped run (`python -m evals run --live …`) before switching a mode
    on, to confirm the model accepts the schemas and to measure cost per turn.

## Also on the list (from `tasks/todo.md`)

- Live grant dump in prod after db push, diffed against local (`supabase/checks/grant_dump.sql`).
- `health_url` row in `app_config` after db push (G4).
- E3 load-test think time (2 s is a coin toss on Medium; 5 s passes comfortably).
- Resend Pro is live. `digest_daily_cap` → 800 is written (migration `20261110000002`,
  joins the batched push); still owner's: Auth emails/hour ≥ 1000 in the Supabase dashboard.
- Vercel plan (Pro before the E3 window).
- Supabase Auth: CAPTCHA toggle, per-IP limits 500 per 5 min, OTP length 6 + templates.
- Separate Upstash database for Vercel Preview (B15).
- Screenshot review (D4) and VoiceOver on phones (E5b).
- AI prerequisites: a separate OpenAI project/key for matching, Azure Container Apps environment,
  Key Vault, registry identity, live-eval cost ceiling.
