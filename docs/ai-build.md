# Foundry AI — build record (A0–A3)

Built 2026-10-06 on `feat/connections`, against [AI-plan.md](../AI-plan.md) and
[AI-evaluation-plan.md](../AI-evaluation-plan.md). Everything runs locally end to end with the fake
provider. Nothing is deployed, no AI flag is on anywhere, and no real model has been called. The
steps that remain are owner steps (prices, keys, Azure, legal wording) or the Part E prod window;
they are listed in [owner-decisions.md](owner-decisions.md).

## What exists

| Area | Where | Notes |
|---|---|---|
| Schema, roles, flags, limits, ledger | `supabase/migrations/20261006000001` | `ai_private` (not exposed by PostgREST); `ai_service` login; `ai_enabled` + per-mode flags, all off; AI operators; microdollar ledger for matching **and** ingestion with daily/monthly/member/controller caps |
| Education + job audiences | `…0002` | Students / Graduates / Both enforced in table RLS and every listing read and write; `creation_source` marks admin-created jobs (F18); F21-safe recreation |
| Consent, concepts, projections | `…0003`, `…0005`, `…0008` | three opt-in choices; reviewed dictionary v1 (329 concepts); projections built by the existing worker (F26) with compare-and-swap promotion; self-reported experience |
| Turns, results, admission, executor RPCs, cron | `…0004` | turn row is the authority (F1), lease + fence; admission checks quotas, surfaced-member cap (F7), queue bound and budget headroom, serialised by advisory locks; result cards re-authorised on every read; seven-day expiry at read time and hourly purge (F31) |
| Health checks | `…0007` | queue age, unreconciled calls, spend at 80% of any cap, failure spike |
| Ingestion hardening (A0.1) | `server/app/{privacy,ledger,schema_validate,openai_client,cv_pipeline,github_pipeline,moderation,worker}.py` | outbound privacy boundary with a final check on the assembled payload; `timeout=90, max_retries=0`; output caps; nested validation; version-aware dedupe; every call metered; inventory test |
| Executor | `server/app/ai/` | claim → screen → grammar or one interpreter call → retrieve (exact + lexical + vector, ≤200) → assess (≤4 parallel batches, cached) → deterministic score → publish; fake provider; slim image `server/Dockerfile.ai` |
| Browser | `frontend/src/app/foundry-ai/`, `api/ai/turns/[id]` | all three modes; polling per F2; server actions with a fail-closed `aiSubmit` bucket |
| Settings, intake, jobs | `settings/AiSettingsCard.tsx`, `components/forms/EducationForm.tsx`, intake, opportunity form | consent controls, preview of what AI uses, education status, audience on every job, View profile (Connect stays in the dialog, F16) |
| Admin | `/admin/ai` | aggregates only; operator-only switches and limits with reasons; jobs needing an audience |
| Notice | `/ai-notice` | factual draft for owner review |
| Evals | `server/evals/` | offline harness; 93 hand-labelled cases; reports, intervals, compare, capped live mode |
| Deploy | `.github/workflows/deploy-ai.yml`, `infra/azure/provision-ai.sh`, `infra/README.md` | manual; ACA, one warm replica, no ingress, Key Vault refs only |

## Evidence (all local)

- pytest 329, plus 14 integration tests against the local Supabase: projections, consent, committee
  and block exclusion, withdrawal as an immediate read deny, admin-created jobs refused, refinement,
  refusals, audiences, idempotency, shared rate limits, concurrent admission, queue bound, claim ceiling.
- SQL: `ai_smoke.sql` (grants, grammar limits, ledger caps, leases, audiences, withdrawal, purge,
  self/admin/job deletion with AI rows) plus the existing suites, all green.
- Vitest 514; E2E `ai` project 8/8 (network, refinement, refusal, recruiter gating, admin-created
  jobs, opportunities, axe, settings, audience prompt), with the browser never contacting a provider
  and status polls private and uncached.
- Evals 92/93; the failure is a labelled known false refusal (see Deviations).

## Gates (AI-plan §14) and where they stand

| Gate | State |
|---|---|
| Access/privacy | Built and tested locally (negative grants, leases, fencing, F17/F18, blocks, withdrawal, deletion). Live grant dump in prod is an owner step. |
| Egress | Inventory test, assembled-payload check, metered calls. Live transport interception against OpenAI: with the live smoke. |
| Relevance | 52 hand-labelled interpretation cases incl. 25 adversarial. **Short of the plan's 150 adversarial + separate benign set**; the deterministic screen and grammar are covered, model behaviour is not yet measured. |
| Quality | Smoke set only (3 ranking scenarios, recall@10 and nDCG@10 gates pass). Held-out, human-labelled, 2k/10k corpora: not built. |
| Score stability, specific+broad, experience/cohorts | Fixtures pass (89/49, companions, pool stability, cohort swap, tenure, duplicates, negation). |
| Audience/visibility | Enforced and tested across list, detail, newest, bookmarks, activity, feed, actions, RLS. |
| Memory | Seven-day archive, read-time expiry, forget, delete; lexical cross-chat retrieval. |
| Saved findings/rescans | Saved for seven days, rescan cooldown and daily cap, New/Updated labels, zero provider calls when nothing changed (cache). |
| Concurrency/cost | Admission, queue bound, claim ceiling and provider cap race-free and tested; ledger caps tested. The 500-submission burst at scale and the hosted load test are Part E. |
| Production capacity operations, admin visibility | `/admin/ai`, operator role, 25% steps, health checks. Alert routing is owner (G5). |
| Latency, Load, Economics | Not measured. Needs the live provider and the Part E window. |
| UI | Axe clean on the AI page; keyboard paths; visible control borders. The §12 usability sessions and the MCP visual pass are not done. |
| Compliance | DPIA, notice wording, processor register, lawful basis: owner (A0.2). Deletion paths tested. |
| Eval harness | Built; live mode built but never run. |

## Deviations from the plan, and why

1. **Clustering**: not built (deferred by F10).
2. **Rescans use fresh bounded retrieval plus the assessment cache, not a change-feed cursor
   (§8.1).** It cannot skip a committed change, and unchanged candidates cost nothing because their
   assessments are cached against an unchanged projection hash. The limit is the same as a first
   search: at most 200 candidates are considered, and the UI never claims an exhaustive scan.
3. **Cross-chat memory is lexical only**; the plan's vector leg over messages is not built.
4. **Functions are owned by `postgres`**, the project's convention, not by separate non-login owner
   roles (§10). The executor's and worker's logins hold EXECUTE only on their own functions, and
   `ai_smoke.sql` proves neither can read a table.
5. **A deterministic screen refuses protected-characteristic and injection requests before any
   model call** (`app/ai/policy.py`), added after the evals showed a model-only refusal could miss
   them. It is deliberately narrow and has one known false refusal in the eval set ("founders
   building products for women's health"). Widening or narrowing it is a product decision.
6. **The fake provider is a rule-based stand-in.** Offline evals test the deterministic pipeline,
   not model quality.
7. **No HTTP ingress, so no opaque capabilities** (F1's fallback design is unused).
8. **Strict structured outputs**: the schemas use `maxLength`/`maxItems`/`minimum`. Check in the
   first live smoke that the chosen model accepts them; if not, drop them from the request schema
   (local validation keeps them).

## Before any flag goes on in production (owner)

See [owner-decisions.md](owner-decisions.md), "Foundry AI". In order: db push → audiences for
existing jobs → prices confirmed → OpenAI matching key → `ai_service` password → Azure provisioning
→ deploy → operator role → legal wording, DPIA → master switch → one mode at a time.
