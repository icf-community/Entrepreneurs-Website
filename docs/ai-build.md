# Foundry AI — build record (A0–A3)

Built 2026-10-06 on `feat/connections`, against [AI-plan.md](../AI-plan.md) and
[AI-evaluation-plan.md](../AI-evaluation-plan.md). Everything runs locally end to end with the fake
provider. Nothing is deployed and no AI flag is on anywhere. Both model stages have since been
live-tested (2026-11-08): the interpreter (`gpt-5.4-mini`) and the recruiter-assessor
(`gpt-6.1-sol`), 0 critical failures on either after several rounds of real bugs found and fixed
(see "Evals" below). The steps that remain are owner steps (prices, keys, Azure, legal wording) or
the Part E prod window; they are listed in [owner-decisions.md](owner-decisions.md).

## What exists

| Area | Where | Notes |
|---|---|---|
| Schema, roles, flags, limits, ledger | `supabase/migrations/20261006000001` | `ai_private` (not exposed by PostgREST); `ai_service` login; `ai_enabled` + per-mode flags, all off; AI operators; microdollar ledger for matching **and** ingestion with daily/monthly/member/controller caps |
| Money-cap ceilings, ledger retention and scale fixes | `…0010`, `…0013` to `…0016` | The money caps have hard table ceilings sized to the $150/month OpenAI budget (monthly $150, matching daily $10, per-member daily $1) and `admin_set_ai_limits` refuses raises over 25% (restoring the default is always allowed). `spend` older than 45 days rolls into exact daily totals; the monthly-cap check is O(1) (closed days cached, today live: 205 ms to 1 ms at a month-end ledger); `exec_retrieve` enables the HNSW iterative scan so filtered vector legs keep returning their 200 candidates as the corpus grows; `cv_worker` can read `cv_profiles.prompt_version`. Measurements and rationale: `tasks/e2e-adversarial-sweep.md`, "Production-readiness pass". |
| Per-member ingestion cap, CV upload limit | `…0017`, `frontend/src/lib/ratelimit.ts` | `ingestion_member_daily_cap_micro` (default $0.25, ceiling $1) caps one member's ingestion spend per UTC day inside `spend_reserve`; a trip raises `budget_exhausted: ingestion_member_daily`, which the worker already defers to the next day. It is a backstop: the CV upload limit (5 per member per 24h, counted at ticket request, in both the Upstash limiter and the in-process fallback) is the main control, and `ingestion_daily_cap_micro` ($5) stays the shared ceiling. Changed by migration or SQL only (`admin_set_ai_limits` is unchanged). |
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
| Evals | `server/evals/` | offline harness; 556 hand-labelled cases across both stages (incl. `assess_quality`, the recruiter-assessor's own live-model suite); reports, intervals, compare, capped live mode — run live multiple times against both `gpt-5.4-mini` and `gpt-6.1-sol`; `corpus.py` retrieval/quality-gate benchmark (2k/10k synthetic corpora) built and run, both PASS |
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
- Evals 417/431 passed offline (fake provider), 0 critical failures; the 14 non-critical failures
  are `requires_live_model: true` cases the fake provider cannot resolve by design (e.g. paraphrase,
  `not_evidenced` evidence) — see `evals/datasets/README.md`.
- Live-model runs (2026-11-08) against both real stages, multiple repeats, 0 critical failures on
  either. Found and fixed six real bugs in the process: hobby-criteria leakage in recruiter mode,
  an audience/approval-restriction injection framing gap, missing British-spelling concept aliases
  (optimisation, data visualisation), a typo-handling gap, a harness scoring blind spot, and an
  `aggregate_repeats` bug that blended cases sharing an id across suites. One residual gap was found
  and deliberately deferred by owner decision: non-English sensitive-content screening is weaker
  than English (model-only, no deterministic backstop) — see `evals/datasets/README.md`'s known
  gaps section.

## Gates (AI-plan §14) and where they stand

| Gate | State |
|---|---|
| Access/privacy | Built and tested locally (negative grants, leases, fencing, F17/F18, blocks, withdrawal, deletion). Live grant dump in prod is an owner step. |
| Egress | Inventory test, assembled-payload check, metered calls. Live transport interception against OpenAI: with the live smoke. |
| Relevance | **Meets the plan's §4 floor**: 160 adversarial cases total (110 main + 50 held-out, 29 families, incl. every named sub-category — mixed math/code, teaching/programming, negation, multilingual, zero-width/encoded injection, malicious CV/JD, cross-candidate contamination) plus a 239-case separate benign set (`benign.jsonl`/`benign_domain.jsonl`, main+held-out). Offline O01 (admission relevance/safety) pass rate 96.35% [94.0%, 97.8%] >= the plan's 95% target; live-tested against `gpt-5.4-mini` with 0 critical failures. The recruiter-assessor's own judgement quality is covered separately by `assess_quality` (26 cases, live-tested against `gpt-6.1-sol`, 0 critical failures). |
| Quality | **Built and run** (`evals/corpus.py`, `python -m evals retrieval --size 2k\|10k`), 2026-11-10: synthetic 2k and 10k corpora, 36 real queries each (12/mode) through the real executor (fake provider). Both sizes PASS all three modes: recall@200 min 1.000, nDCG@10 mean 0.965-1.000, zero ineligible hits, zero grade-3 losses. `exec_retrieve` p95 ~230ms-525ms at 10k/2k. Smoke set (3 ranking scenarios) also still passes. Scope decisions not yet done: the plan's four retrieval-leg ablations, fair-exposure slice breakdowns, and paired-bootstrap confidence intervals on nDCG@10 — see `evals/corpus.py`'s own docstring. |
| Score stability, specific+broad, experience/cohorts | Fixtures pass (89/49, companions, pool stability, cohort swap, tenure, duplicates, negation). |
| Audience/visibility | Enforced and tested across list, detail, newest, bookmarks, activity, feed, actions, RLS. |
| Memory | Seven-day archive, read-time expiry, forget, delete; lexical cross-chat retrieval. |
| Saved findings/rescans | Saved for seven days, rescan cooldown and daily cap, New/Updated labels, zero provider calls when nothing changed (cache). |
| Concurrency/cost | Admission, queue bound, claim ceiling and provider cap race-free and tested; ledger caps tested. The 500-submission burst at scale and the hosted load test are Part E. |
| Production capacity operations, admin visibility | `/admin/ai`, operator role, 25% steps, health checks. Alert routing is owner (G5). |
| Latency, Load, Economics | Not measured. Needs the live provider and the Part E window. |
| UI | Axe clean on the AI page; keyboard paths; visible control borders. The §12 usability sessions and the MCP visual pass are not done. |
| Compliance | DPIA, notice wording, processor register, lawful basis: owner (A0.2). Deletion paths tested. |
| Eval harness | Built and run live, repeatedly, against both model stages (2026-11-08); 0 critical failures on either. |

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
   them. It is deliberately narrow. It previously had a false refusal on sector-domain searches
   ("founders building products for women's health") — fixed 2026-11-08 (`4f2b192`,
   migration `20261108000001`): `DOMAIN_TERMS` exempts women's/men's health, digital health,
   healthtech and femtech as product domains, while still refusing the same message if an actual
   person-trait appears beside the sector phrase (e.g. "women's health founders who are women").
   Widening or narrowing the exemption list further is a product decision.
6. **The fake provider is a rule-based stand-in.** Offline evals test the deterministic pipeline,
   not model quality.
7. **No HTTP ingress, so no opaque capabilities** (F1's fallback design is unused).
8. **Strict structured outputs**: the schemas use `maxLength`/`maxItems`/`minimum`. Check in the
   first live smoke that the chosen model accepts them; if not, drop them from the request schema
   (local validation keeps them).
9. **Sensitive-content screening is English-only.** Both deterministic layers (`app/ai/policy.py`
   and `ai_private.is_sensitive()`) match on an English-word regex; a live-model eval run showed
   non-English sensitive requests (tested in Chinese and Italian) are caught by the interpreter
   model alone only ~1 in 5 times, with no deterministic backstop. Owner decision 2026-11-08:
   deferred to post-launch, not a launch blocker. `interpret.txt` got a language-agnostic
   instruction as a partial mitigation. Properly closing this needs real multilingual coverage in
   the deterministic layers (translate-then-screen, or per-language term lists).

## Regression scenario traceability (AI-plan-review.md §"Regression scenarios", 1–22)

Added during S5 (gap 28). Each row names the test(s) that actually prove the scenario, not just a
file that touches the area. Two gaps found during S5 were closed then; the two gaps S5 left open
(#4, #20) were closed on 2026-11-10.

| # | Scenario (abbreviated) | Proven by |
|---|---|---|
| 1 | PyTorch/TensorFlow OR vs required; "no experience" isn't evidence | `evals/datasets/scoring.jsonl` (score-fixture-001); `evals/datasets/transformations.jsonl` (xf-tool-swap-001/002, xf-negated-not-met-001, xf-aspirational-not-met-001); `test_ai_integration.py::test_recruiter_requires_confirmed_requirements_then_finds_eligible_candidates` ("TensorFlow alone never meets a PyTorch requirement") |
| 2 | Mixed safe+off-task request produces no result until confirmed; "who teaches Pythagoras" stays usable | `evals/datasets/adversarial.jsonl` (mixed, off-homework families); `test_ai_integration.py::test_off_task_and_sensitive_requests_are_refused_without_results` |
| 3 | Opt-out mid-assessment blocks publish; withdrawal is an immediate read-deny | `test_ai_integration.py::test_withdrawal_hides_existing_results_immediately`; `test_ai_races.py` R6 |
| 4 | Identical source re-upload after a policy-version bump doesn't reactivate the old profile unchanged | `test_projection.py::test_projection_hash_changes_with_policy_version` (closed 2026-11-10) — `projection_hash` provably includes `policy_version` (`app/projection.py` — `policy = f"{privacy.POLICY_VERSION}/{PROJECTION_VERSION}"`, hashed into the digest); the new test monkeypatches `privacy.POLICY_VERSION` and asserts the hash changes with the content held fixed. |
| 5 | 20 concurrent turns, late responses, cross-midnight retries never leak reservations or bypass the monthly ceiling | `test_ai_races.py` (R1, R2, R7, R11); `test_ai_limits.py` (all 5 money-cap boundaries incl. `matching_monthly_cap_boundary`); `test_ai_outage_drills.py` (storm, reconnect) |
| 6 | A direct service-role RPC with another member id can't forge an admitted turn or read arbitrary data | `test_ai_integration.py::test_executor_role_cannot_touch_tables`; `ai_smoke.sql` grants section |
| 7 | A candidate's score is unaffected by pool changes or other recruiters' actions; missing evidence isn't phrased as proven absence | `evals/datasets/scoring.jsonl` ("stable" / `pool_additions`); `evals/datasets/transformations.jsonl` (xf-duplicate-evidence-001, xf-irrelevant-evidence-001); `app/ai/score.py` module docstring ("Adding unrelated candidates cannot change anyone's score") |
| 8 | Two tabs can't overwrite criteria or remap a result slot; a disconnect can't duplicate a paid run | `test_ai_races.py` R4 (stale revision), R14 (monotonic polling), R15 (double-click); `test_ai_integration.py::test_idempotent_resubmission_returns_the_same_turn` |
| 9 | An expired/withdrawn/unapproved job is never used; an event or grant can't masquerade as a recruiter job | `test_ai_integration.py::test_admin_created_job_never_unlocks_recruiter_mode`; **`test_an_event_cannot_act_as_a_recruiter_job`** (new this pass — closes the "event/grant" half, which had no test before) |
| 10 | Published cards show View profile only, no duplicate a11y ids, one connection-state RPC per open | `frontend/e2e/ai.spec.ts` ("View profile opens their dialog"); axe pass in the same project |
| 11 | Graduate/enrolled audience eligibility, including direct detail/bookmark/feed routes | `test_ai_integration.py::test_opportunities_respects_audience_and_own_jobs`; the education/audience RLS suite (`…0002`) |
| 12 | 168h expiry with no resurrection via summary/cache/SLM; retained messages readable before expiry | `test_ai_memory.py::test_r16_a_message_forgotten_before_its_vector_lands_stays_forgotten`; `test_ai_properties.py` invariant 4 (no stale `effective_spec` atom); `cron_purge` |
| 13 | Idempotency/mode/tab tricks and a Redis outage can't bypass quotas; no paid call without a prior reservation | `test_ai_limits.py` (full registry); `test_egress_transport.py::test_the_metering_boundary_refuses_a_dirty_payload_before_any_request_is_sent`; `frontend/src/lib/ratelimit.test.ts` (fail-closed, incl. `aiSubmit`) |
| 14 | Saved findings expire in 7 days without renewal on view; opt-outs vanish immediately; rescans pick up new consent | `test_ai_races.py` R10 (rescan cooldown/cap); `ai_smoke.sql` (7-day expiry) |
| 15 | Broad area evidence earns broad credit without inventing a specific tool; alias/ancestor repetition can't inflate relevance | `evals/datasets/transformations.jsonl` (xf-added-ancestor-evidence-001); `evals/datasets/scoring.jsonl` fixtures |
| 16 | Mentor-seekers aren't labelled offers; availability isn't employment consent; preferences never alter the score | `app/ai/score.py concept_state` (seek/offer kind split); `app/ai/pipeline.py _preference()` — structurally separate from `score_candidate`'s inputs, documented in `evals/authoring/transformations.py`'s module docstring rather than re-modelled there |
| 17 | A source-junction-only edit invalidates the projection; private columns can't leak via the directory; graduation never triggers cleanup | `test_projection.py::test_projection_hash_changes_with_content_only`; `rls_smoke.sql` §38 ("nobody is deleted" — graduation leaves account/connections intact) |
| 18 | An eval run with a skipped mandatory suite, an uncalibrated judge, or no ground truth can never be reported "passed" | `evals/runner.py` (`verdict` fails on any `skipped_suites`); `evals/datasets/README.md` ("v1 uses no model graders") |
| 19 | A turn queued >60s still runs under its own lease/fence, never a stale holder | `test_ai_races.py` R2, R7 |
| 20 | Reopening saved results makes zero provider calls | `test_ai_integration.py::test_reopening_saved_results_makes_zero_provider_calls` (closed 2026-11-10) — a counting wrapper around `FakeProvider` proves a completed turn's status/cards reads never call the model or embedding provider again. |
| 21 | The surfaced cap refuses the next request at admission, before any money is reserved | `test_ai_races.py` R1; `test_ai_limits.py` `surface_limit` boundary |
| 22 | Parallel assessor batches respect both caps and the 45s deadline; no retry launches without full attempt time left | `test_ai_outage_drills.py` (storm, ≤3 calls/turn); `test_ai_admission_burst.py`; `app/ai/pipeline.py with_retry`/`remaining()` |

## Before any flag goes on in production (owner)

See [owner-decisions.md](owner-decisions.md), "Foundry AI". In order: db push → audiences for
existing jobs → prices confirmed → OpenAI matching key → `ai_service` password → Azure provisioning
→ deploy → operator role → legal wording, DPIA → master switch → one mode at a time.
