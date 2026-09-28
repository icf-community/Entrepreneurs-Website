# Foundry AI plan review — 2026-09-26

**Outcome: material flaws found; revised plan written, implementation not started.**
The corrected, consolidated contract is [AI-plan.md](AI-plan.md). This review does not certify
the current application or future implementation secure or legally compliant.

Reviewed the complete 1,000-line external plan, matching spec, Graphify graph and referenced
working-tree code at `8fb8290`. Checked official OpenAI, ICO, European Commission, pgvector and
Azure documentation. The deployment follow-up also checked current official Azure Container Apps
scaling/reliability and Vercel region/duration/cache guidance. No production data, credentials,
databases or provider calls were exercised.
Existing edits to `after-supabase-pro.md` and `scalability-audit.md` were left untouched.

Updated 2026-09-26 for owner-confirmed Students / Graduates / Both postings, graduates across
all affiliations, and rolling seven-day cross-chat memory. These remain planned controls.
The owner also confirmed seven-day saved recruiter findings; bounded rescans and expanded cost/
abuse tests are specified in AI-plan §§8.1,9.1,14.1. These tests have not been executed yet.
The 2026-09-26 follow-up consolidates the owner-approved skill, requirement, network intent,
job-preference, privacy, graduate-lifecycle and source-freshness fixes in AI-plan §14.3. That pass
found no additional data/migration issue beyond the inventory at that time. The later UX/deployment
follow-up added R45–R50 below; neither pass guarantees implementation or launch review will find no
further issue.
The owner then set UX as the highest product priority and required capacity for at least 500
concurrent users. Source-only review found existing card semantics, filter picker, detail-recovery
and mobile-target issues; the Impeccable detector emitted no findings, but browser inspection was
unavailable. AI-plan §§12 and 14 now include these fixes, formative usability evidence, and a
500-user staging target with AI admission/load controls. No live UI or capacity test was performed.
The subsequent deployment follow-up records the two-VM tradeoff, warm ACA topology, request-path
latency plan and a known failed local authenticated-load run in AI-plan §§10.1 and 14. These are
release blockers/evidence requirements, not implementation or capacity claims.

Updated 2026-09-28: a third pass (R57–R89) corrected the execution/security model, deadline and
capacity arithmetic, Connect placement, executor RPC exposure, admin-created jobs, audience cutover,
deletion, job runners, staging assumptions and Playwright coverage. The AI plan is now executed as
phase 6 of the [launch-readiness programme](docs/launch-readiness-programme.md).

The follow-up [data audit](AI-data-audit.md) screens all 134 migrations (24,600 lines), with
[per-file coverage](docs/ai-migration-inventory.md), and traces relevant later definitions plus
CV/GitHub producers. The owner confirmed using broad capabilities **and** individual tools;
AI-plan §7.3 makes both score contributions explicit. The required custom harness is specified
in [AI-evaluation-plan.md](AI-evaluation-plan.md); no harness execution is claimed.

## What is already correct

The fixed pipeline, no tools, bounded candidate cards, structured interpretation, application-side
scoring and staged recruiter/network/opportunities rollout are good foundations. Postgres is
appropriate at this scale. Following owner feedback, a typed memory graph in Postgres is now
included (AI-plan §5.1); no separate graph database is needed. Specific CV tools
are available beyond the broad taxonomy. Job ownership must use `opportunities`, not a new
`postings` table. “Posted by” already exists, and private-interest inference needs consent.

## Findings and corrections

Severity describes the consequence **if the plan were implemented as written**. Where a problem
already exists in source, that is stated explicitly. “Corrected” means corrected in the plan;
application fixes remain on the implementation checklist.

| ID | Severity | Finding and evidence | Correction in AI-plan |
|---|---|---|---|
| R01 | High, current + planned | Redaction placed before `extract_profile` misses the earlier moderation call. Current worker stores text at `server/app/worker.py:314`, moderates it at `:342`, extracts at `:361`; `cv_sanitise.py:219` removes invisible text but not contact PII. | §3 applies local policy before **all** provider egress, including moderation/embeddings/GitHub; no claim regex guarantees anonymity. |
| R02 | High, current + planned | Regex-only raw-text/chunk backfill leaves structured profiles, combined summaries, GitHub READMEs/URLs and derived vectors untouched. `github_pipeline.py:960` serialises the full profile and signal into a prompt. | §3 backfills all derived stores, quarantines incompatible versions, preserves separate non-model self-profile links and documents originals/backups separately. |
| R03 | High | Bumping `extract-v8` does not prevent the current hash-reactivation path (`worker.py:325`) from reusing old extraction without checking its prompt/redaction version. | §3 version-aware dedupe and atomic promotion; migration tests cover re-uploading identical old files. |
| R04 | High | Original §§1–2 expose free-form `ignored_fragments`, chip `display`, criteria and quotes while asserting there is “no answer channel”. Fuzzy grounding can misread negation or invented values. | §4 static notices, IDs/enums/validated source spans, no model prose, typed operations and exact provenance; mixed prompts require confirmation of the safe search. |
| R05 | High | “Every token is a known term or stop word” is not a grammar: “not Python”, Go ambiguity and changing global aliases undermine intent. Automatic >=.92 alias merging can collapse related tools or poison shared terms. | §§4,7 reviewed aliases, separate relatedness, fully consumed parser, mode-specific policy and no automatic global promotion of query text. |
| R06 | High | `required` free atoms become extra weight; there is a three-required cap; soft criteria automatically disappear. The user's “must also” is not guaranteed. | §5 required is a predicate, unknown is not met, no silent dropping/relaxation; explicit OR/NOT/conflict handling. |
| R07 | High | A 40% exact-tool component cannot guarantee exact PyTorch beats TensorFlow: e.g. PyTorch tool component 40 plus no other support versus TensorFlow 20 + 45 assessment + 15 retrieval = 80. | §7 exact-required eligibility, exactness ordering for explicit tools, separate evidence score and labelled transferable alternatives. No claim exact tools prove overall ability. |
| R08 | Medium | Min-max similarity gives unstable scores when unrelated candidates enter/leave the pool and has an undefined equal-score denominator. Fatigue lowers displayed relevance due to other recruiters' actions. | §7 evidence-only absolute rubric per criteria; no pool normalisation or popularity/fatigue penalty. |
| R09 | High | The plan alternates one combined search embedding with “both embeddings”; clearing private text cannot subtract private influence from a combined vector. A late worker can restore withdrawn data. | §6 purpose/view projections, synchronous dirty/consent epochs and fenced promotion; §8 current permission/version checks on caches and replay. |
| R10 | High | Hash-keyed assessments lack an explicit member FK; FK purge is asserted without its schema. 60s local LRU and unfenced in-flight puts can survive DB purges. | §§8,11 member FKs, purpose/version/consent keys, write-time eligibility and stale-result suppression across all reads. |
| R11 | High | Recruiter dimensions keyed only to original posting content ignore changed refinement criteria; atom string hashes omit qualifiers and interpretation versions. | §8 effective-context hashes for contextual dimensions; complete semantic/rubric/model/policy keys. |
| R12 | High | “Chip actions cost zero” includes actions that retrieve new candidates and miss assessment caches. They can bypass the paid-search path. | §§8–9 distinguish editing a draft from executing it; every execution uses the ledger and bounded call plan. |
| R13 | High | A dedicated OpenAI project's “hard monthly budget” is not the project-alert guarantee. Estimated reservations plus unconditional release on failure/cancel allow concurrent/timeout spend to escape accounting. | §9 hard DB daily/monthly ceilings, pessimistic per-attempt reservations, uncertain-call reconciliation and verified organisation limit as secondary protection. See official [spend controls](https://developers.openai.com/api/docs/guides/terraform/rate-limits-and-spend). |
| R14 | High | SDK retries plus app retries multiply calls; background term/doc/JD work is omitted; replicas do not share a TPM gate. Flipping `ai_enabled` on daily exhaustion mixes administrative and budget state. | §9 explicit retry ownership, all egress cost categories, shared capacity, independent budget state/reset and measured usable quota. |
| R15 | High | Short RPC advisory locks end with the transaction. An unfenced 30s pending lease can expire during 20s requests + retry and permit two owners. Browser-independent persistence is asserted without crash ownership. | §§8–9 durable lease/fencing, versioned completion, durable attempt/turn state, idempotency and conservative treatment of uncertain billing. |
| R16 | High | The AI runtime both holds the HMAC ticket signing secret and can execute RPCs trusting `member_id`. A compromised runtime can impersonate any member despite no table SELECT grants. Tickets omit operation/body/version binding. | §10 DB-issued opaque capabilities; service cannot mint identities; method/purpose/body/turn scope, owner checks and bounded candidate-set handles on every RPC. |
| R17 | High | Revoke-new-RPC rules do not audit existing PUBLIC EXECUTE, inherited roles or object ownership. Claiming no table grants does not prove least privilege. | §10 role/grant/function-owner audit and direct-bypass tests; no service-role fallback. |
| R18 | High | Cloudflare source-IP allowlist does not authenticate the site's zone; CORS is not authentication. Default ACA hostname/Host and origin paths are unspecified. | §10 origin authentication plus host validation/default-route denial, ingress/cert renewal tests, scoped capabilities and secrets isolation. |
| R19 | High, implementation dependency | Reusing `openai_client.client` loads `worker_settings`, which requires broad DB/GitHub/blob configuration (`config.py:114`, `worker_settings()`). `db.connection` uses that broad DSN and is not a pool. `cv_pipeline` is not a minimal embedding adapter. | §10 separate AI settings/client/DB pool and import boundary, with a secret-absence boot test. |
| R20 | Medium | Bounded SQL is asserted “one HNSW scan” and <50ms without measurement. Filtered ANN may underfill or miss exact tools; caps vary between 200/30/20. | §6 one bounded 200→20→10 contract, protected exact candidates, selective-filter recall/EXPLAIN tests and bounded fallback. See [pgvector](https://github.com/pgvector/pgvector). |
| R21 | Medium, current + planned | Worker claims FIFO (`worker.py:110`); new low/high priorities are not present. It calls embedding functions while holding the persistence transaction (`worker.py:366–385`: `normalise_skills` and `chunk_and_embed` run inside `with connection()`). Existing dedupe deliberately allows follow-up work while running. | §6 explicit queue scheduling/fairness and compute-outside-transaction work, preserving retry/lost-update behaviour. |
| R22 | Medium | Simultaneous messages lose updates; streamed ranking changes numbered references; updated candidates can pair old scores with fresh evidence. | §§5,9,11 CAS spec revisions, owner-scoped idempotency, stable turn/slot refs, version-bound evidence and final ranked publication. |
| R23 | Medium, current mismatch | `/members/[id]` is absent; `frontend/src/app/members` contains only list page/loading/client. Existing `MemberDialog` is the actual profile UI. | §12 reuse dialog with optional authorised match context; remove planned broken route/banner links. |
| R24 | Medium, current mismatch | `Opportunity.postedBy` lacks ID/avatar (`frontend/src/lib/data/opportunities.ts:26`), although ConnectControl requires memberId. That control performs four RPCs per mount and uses repeated fixed note IDs. | §§2,12 extend mapper/RPC identity safely, reuse photo signing, batch/lazy-load connection state and use unique DOM IDs for repeated cards. |
| R25 | High | Quotes matching generated chunks do not prove original-CV provenance; keyword-only sensitive screening misses inference and context. “No evidence” is treated as “no skill”. | §§3,7 immutable source evidence references, separately opted-in quote disclosure, local checks/quarantine, unknown-evidence labels. |
| R26 | High, current | Privacy page says extracted text is never stored/sent externally and uses fixed string matching (`privacy/page.tsx:78`). ROPA N/O and DPIA screening repeat this; architecture says no AI. Actual worker contradicts them. | §13 urgent factual reconciliation and existing-processing assessment; full DPIA/notice/consent work before rollout. These public documents have **not** been corrected in this planning-only change. |
| R27 | High | “Humans decide” and public-directory legitimate interests are treated as sufficient conclusions. Top-ten omission, protected proxies, evidence disclosure and objection are inadequately addressed. | §§1,7,13 granular controls, meaningful review/correction, legal applicability assessment and no fairness-by-fatigue claim. See [ICO recruitment review](https://ico.org.uk/about-the-ico/what-we-do/recruitment-rewired/). |
| R28 | Medium | Promised zero off-task responses/one-rating injection effect and cache-hit/latency/cost claims read as guarantees. Mock client does not implement Responses or moderation and returns zero embeddings. | §§4,14 residual-risk language, attack/benign tests, realistic contract mocks and measured gates instead of claims of safety or performance. |
| R29 | High, design gap raised by owner | Generic experience/depth dimensions can over-reward long alumni careers for student/entry roles; optional-CV alumni risk being treated as inexperienced. Current intake requires only students to upload CVs (`20260901000013_intake_role_gates.sql:122`), and requires everyone to supply LinkedIn. No deployed matcher exists to demonstrate this empirically. | §7.1 separates explicit role eligibility, level and relevant experience; saturates duration credit; handles overlaps/unknowns; adds optional structured experience input and mixed-cohort regression fixtures. |
| R30 | High, revised requirement | Directory role is not education status: intake `NO_GRAD_YEAR` excludes mentors/angels/staff from graduation-year collection; an enrolled postgraduate may also be a graduate. The earlier role-union selector would misclassify members under the owner's broader definition. | §§5,7.2 independent education facts with provenance/unknown handling; Students/Graduates/Both intersection with approved posting audience; preserve affiliation and CV gates. |
| R31 | High, new access-policy dependency | Current list/home/bookmark RPCs and RLS lack audience predicates; `mark_listing_action` checks listing approval; community approval triggers copy job descriptions into posts. Filtering only the UI/AI would leave other reads and actions exposed. | §7.2 shared applicant predicate, explicit management exception, migration of all RPC/RLS/action paths and inherited community visibility; version invalidation, legacy review and external-application limitation. |
| R32 | High, revised requirement | A graph summary alone cannot preserve all source detail; clustering can hide unindexed items and carry expired or cross-owner information into later chats. Earlier fixed 30-day/same-thread design no longer meets the request. | §5.1 source archive plus bounded scoped retrieval, nonexclusive clusters, optional budgeted background SLM and source-grounded corrections; owner-selected seven-day expiry cascades to all derived chat memory with read-time enforcement and worker fences. |
| R33 | High, implementation dependency | Current limiter deliberately falls back to per-instance counts during Redis failures and permits calls when Redis is absent (`frontend/src/lib/ratelimit.ts:266–293,393–415`). Reusing that as AI spending authority would multiply allowance across replicas or remove it when misconfigured. | §9.1 authoritative shared DB admission before every paid call, fail-closed money enforcement, combined mode/member limits, route-policy registry and direct-path/outage/concurrency transport-spy tests (§14.1). Existing limiter behaviour is not changed in this planning review. |
| R34 | High, new feature dependency | Saved recruiter findings can retain withdrawn candidates; rescanning account creation dates misses older members' new evidence/opt-ins and late-ready projections. Naive automatic scan-per-join fans out across all jobs. | §8.1 seven-day live-authorised saved findings, projection-ready committed change feed, bounded delta plus baseline retrieval, deduplicated explicit rescans, coverage cursors, no-change zero-provider path and no automatic paid fan-out. |
| R35 | High, current data interpretation risk | `skills.aliases` groups PyTorch/TensorFlow under Deep learning; `normalise_skills()` accepts nearest `cv_skills` at cosine >=.8; `member_skills.confidence` stores that similarity. Treating either as exact proficiency loses distinctions or invents skills. The extracted taxonomy is seeded outside migrations. | §7.3 and data audit §2 retain broad and specific layers, reviewed exact aliases, mapping versus evidence confidence, preserved unmapped terms, versioned seeds and non-duplicated score contributions. |
| R36 | High, extraction/retrieval coverage | CV flat skills lack per-role provenance; projects lack dates; method/nonsoftware extraction needs evaluation. GitHub worker normalises languages only, excludes Shell/HCL metadata and current-CV display RPC omits members without CVs. | Data audit §§2,6: typed source assertions and task links, unknown duration, method/nonsoftware fixtures, demonstrated Bash/Terraform support, purpose projections for GitHub-only/manual evidence without widening collection. |
| R37 | High, current access-policy mismatch risk | `20260901000009_lock_cv_columns` explicitly grants scalar venture/current-focus/urgency/availability reads; profile directory RLS allows other approved members. UI omission does not make them private. Interests/intents tables have different owner/admin-only policies. | Data audit §6: explicit field visibility inventory, separate owner-private work preferences, review legacy scalar disclosure and update reads/grants before claiming confidentiality; no broad RLS bypass for AI. |
| R38 | High, current product conflict | Latest `admin_delete_graduates` (`20260917000009`) manually deletes approved student accounts and their postings by graduation-year cutoff; `/admin/graduates` invokes it. This conflicts with retaining graduate members if used as the transition. | A0/data audit §6 recommends retiring graduation-year deletion in favour of confirmation/transition and secure account/email continuity, while preserving actual account deletion. No live deletion/auth change performed. |
| R39 | High, requirements ambiguity | `opportunity_skills` has broad IDs without required/preferred, OR groups, versions or duration; title/JD/tag conflicts could create false hard requirements. | Data audit §3: source-linked approved requirements preview, poster/admin confirmation, independent search refinements and criterion evidence matrix; candidate correction and ambiguous/unknown states. |
| R40 | Medium, network product gap | Ranked `profile_intents` describe wants; mentor/cofounder role labels and generic availability do not prove willingness to offer help. A similarity-only matcher misses complementary collaborators. | Data audit §4: explicit seeking/offering and purpose-specific availability, shared/complementary goals, connection-state handling and consented interest projections. |
| R41 | Medium, opportunity product gap | Job pay/location are free text, start is month/year and no employment type/duration exists. Generic member intake availability is not a private work-preference record; clicks/applied markers are not verified outcomes. | Data audit §5: structured job logistics, optional owner-private preferences, ability/eligibility/preference separation, consistent date semantics and explicit bookmark/applied/dismiss controls. |
| R42 | High, invalidation dependency | `profile_version` denotes intake completion; junctions, skills deleted/reinserted by source, showcase and taxonomy changes cannot reliably use one profile timestamp as an epoch. | Data audit §6 and plan §2.1: explicit source/purpose versions, all mutation paths, transactional invalidation and late-worker fencing; child-only update fixtures. |
| R43 | Medium, implementation-document conflict | Unimplemented `server/app/agent.py` still permits hidden social-graph ranking and sketches nonexistent tools/tables, contrary to the revised no-social-signal bounded design. | Plan §2.1 explicitly supersedes that stub guidance; reconcile it during implementation and test that connection metadata changes cannot alter ability scores. |
| R44 | High, validation gap | Existing CV unit tests and planned broad quality targets do not constitute an objective-based harness spanning extraction, model interpretation, retrieval, scoring and all three modes. A model judge alone could certify its own errors. | AI-evaluation-plan: 12 objectives, versioned labelled cases/splits, independent oracles, stage/end-to-end modes, calibrated optional graders, repetitions, objective/slice reports and hard spend caps. Harness implementation and execution remain required. |
| R45 | High, UX/accessibility gap in existing surfaces | `/opportunities` and `/members` use clickable `div role=button` containers with nested interactive links/actions; the searchable listbox does not provide a full keyboard model; profile detail failures can be silent; some mobile targets are small. A clean static detector result did not resolve these source-level issues, and live browser review was unavailable. | AI-plan §12 requires semantic independent actions, complete keyboard behavior, visible retry/recovery, practical mobile target sizing, contextual AI entry points, preserved URL filter/page state, and task-based usability checks before launch. Fix these incumbent patterns as scoped work alongside AI rather than carrying them into the new surface. |
| R46 | High, capacity target gap | Previous acceptance specified 50 concurrent AI turns and did not demonstrate the owner's requested 500 concurrent users across realistic site traffic. A connection limit is not proof of throughput or database capacity. | AI-plan §14 load gate now requires 500 distinct authenticated synthetic virtual users for a production-like 30-minute scenario, representative browse/search/profile/listing reads and writes, 50 simultaneously running provider turns plus a separately bounded queue, a 500-submit AI burst with bounded admission, and 1,000-user headroom/recovery before claiming readiness. No capacity result is claimed. |
| R47 | High, deployment decision gap | The earlier plan named ACA but did not explain whether it adds a third VM, how to avoid cold starts, or why not share the gateway/ingestion hosts or execute entirely in Vercel. Existing hosts are small and have distinct exposed/untrusted workloads. | AI-plan §10.1 recommends Vercel as the short authenticated boundary plus an isolated ACA executor, with two warm replicas as a starting point, no scale-to-zero, bounded durable queue, staged cost/capacity spike, and explicit comparisons against co-location and Vercel-only execution. ACA is managed compute, not a third VM to patch; it still adds service spend. |
| R48 | High, known but non-production capacity failure | `docs/audits/C6-launch-capacity-and-connections.md` reports both 100- and 500-VU local authenticated-load stages failed. At 500 VUs, 84.79% of page checks failed and many local Supabase calls reset; auth redirects contaminated samples and only 20 identities were reused. This is not proof of production failure or readiness, but cannot be ignored. | AI-plan §§10.1,14.3 make the failure a known blocker: correlate Auth/PostgREST/Kong/Next/database telemetry, correct the cause, then run 500 distinct synthetic sessions against the intended staging deployment plus 1,000-user headroom. Current capacity remains unsigned. |
| R49 | Medium, request amplification | C6 notes CV/GitHub dialogs poll every two seconds with overlapping timers; 500 visible dialogs could create roughly 250 status reads per second. Similar high-frequency polling in the new assistant could erase query/cache gains. | AI-plan §10.1 requires one in-flight status request, jitter/backoff, hidden-tab pause, conditional revisions and bounded event-stream/poll fallback; load-test active progress sessions with page reads. |
| R50 | Medium, deployment latency/locality | Authenticated pages render dynamically; C6 calls for measuring actual Vercel Function region and proximity to Supabase. Compliance notes name Supabase London and Vercel Frankfurt, while live settings remain unverified. Dynamic/private responses cannot safely be made public-cacheable to hide the round trip. | AI-plan §10.1 keeps private/no-store data private, caches only safe shared content, instruments browser-to-Supabase stages, and requires reconciling actual regions; evaluate Vercel London and ACA UK South near Supabase London only after legal, tier and latency checks. |
| R51 | High, owner-reported capacity regression | The owner reports a k6 run handled 50 concurrent users but failed at 100. The environment, build, workload, thresholds and failure traces were not provided in this review, so the failure cannot yet be attributed to Supabase Free, Resend Free, Vercel, the test rig or application behavior. | AI-plan §10.1 records it as an unresolved launch blocker. Preserve/reproduce the test in production-like staging after Pro upgrades; diagnose the limiting stage before changing capacity settings. The target stays 500 concurrent authenticated users across roughly 2,000 members, plus 1,000-VU headroom/recovery. |
| R52 | High, capacity and UX contract | A queue can safely smooth a burst but cannot create model/provider capacity. Treating “500 AI turns” as 500 simultaneous generations could cause provider throttling, cost spikes, database saturation or long waits; merely accepting 500 into a queue can still produce a poor experience. Streaming unvalidated candidate data also risks exposing partial or stale results. | AI-plan §§9–10.1 recommend 500 site users and safe handling of a 500-submission burst, but start with 50 active model turns; raise the tested ceiling gradually against provider, DB, latency, queue-age and budget gates. Use owner-scoped idempotency, bounded backlog/queue-wait admission, a durable turn ID, safe progress events and atomic result publication only after validation/authorization. |
| R53 | High, production operations gap | A configurable concurrency cap without privacy-safe saturation metrics, actionable alerts, and an operator change/rollback process either stays too low under demand or is raised blindly and risks throttling, queue delay, database pressure, or spend spikes. | AI-plan §10.1 now specifies bounded-dimension metrics, queue/provider/DB/worker/spend alerts, sustained-demand plus headroom criteria, versioned shared cap changes, small staged increases, peak-window observation, and immediate rollback. Raising concurrency never relaxes user quotas, hard spend ceilings or privacy controls. |
| R54 | Medium, performance feedback gap | A single load-test pass/fail or aggregate page duration cannot show whether latency is in the browser, Vercel, Auth, Postgres, cache, AI queue, provider or result hydration; optimizing without comparable stage timings risks moving work rather than improving the experience. | AI-plan §10.1 and §14 require repeatable development/release latency audits with lab Web Vitals, privacy-approved aggregate field signals, stage percentiles, realistic cold/warm and 2k/10k data/load cohorts, privacy-safe traces and remeasurement after fixes. |
| R55 | High, operational visibility and privilege gap | Existing plan called for admin aggregate usage but did not specify a full live health/latency/capacity view or who can adjust concurrency. Giving all community admins infrastructure controls or candidate-level traces would create unnecessary privacy and privilege risk. | AI-plan §§10.1 and 14 require aggregate health for admins, a distinct restricted AI-operator capability for limit/kill-switch changes, an evidence-based hard maximum, audited access/change records, named alert owners/escalation, no content or PII in telemetry, and fail-safe behavior when dashboards are unavailable. |
| R56 | Medium, evaluation confidence gap | Twenty labelled items per mode can seed development but may be too few to support narrow recall/ranking confidence intervals or conclusions on sparse/high-risk cohorts. Passing a small benchmark can overstate model quality. | AI-evaluation-plan §4 and AI-plan §14.1 now distinguish smoke-set minimums from held-out release evidence; pre-register sample size from confidence precision and report underpowered slices as inconclusive. |

### Third review pass — 2026-09-27/28 (F1–F33 → R57–R89)

Source-verified against the working tree (graphify-first, then the cited files). Rows map one-to-one
to findings F1–F33 in the [launch-readiness programme](docs/launch-readiness-programme.md), Part A.
Owner decisions from this pass are recorded in AI-plan §1.

| ID | Severity | Finding and evidence | Correction in AI-plan |
|---|---|---|---|
| R57 (F1) | High, design contradiction | §10 had the runtime consume a 60-second opaque capability, but the preferred ACA executor has no ingress and claims from a Postgres queue, so it never receives one; a capability would also expire while its turn waits. | §10: the user-session admission RPC inserts the turn (actor = `auth.uid()`); `ai_claim_turn()` returns a lease + fencing token; every service RPC takes `(turn_id, lease_token)` and derives the actor from the turn. Capabilities kept only as the ingress fallback. |
| R58 (F2) | Medium, design contradiction | §9 preferred an event stream, §10 said poll, §10.1 preferred a stream again. SSE on Vercel keeps a billed function open and still polls Postgres; Supabase Realtime is unused in `frontend/src`. | §§9, 9.1, 10, 10.1: polling only in v1 (one in flight, conditional reads, ~1→2→4 s jittered backoff, hidden-tab pause); stream limits replaced by poll limits. |
| R59 (F3) | High, arithmetic | 1 interpreter + 4 assessors at 20 s each cannot fit 45 s sequentially; "50 active turns" was used as if it capped provider concurrency, but 50 × 4 = 200 requests in flight. | §9: interpret → retrieve → 4 assessor batches in parallel (≈41 s worst case); retry only if a full attempt still fits; separate active-turn and in-flight-request caps; ceiling = min(50, RPM/TPM-derived). |
| R60 (F4) | Medium, unmeetable target | "Warm AI result p95 < 2 s" cannot hold for natural-language turns, which always pay for an interpreter call. | §14 Load gate: < 2 s only for no-provider-call paths; cached natural-language turns get a provisional < 6 s. |
| R61 (F5) | Medium, over-provisioning | The $5/$10/$15 caps allow tens to low hundreds of turns a day, yet the plan provisioned for 50 concurrent turns with two always-warm ACA replicas. | §§9, 10.1: throughput is spend-limited; derive turns/day from measured cost; start at one warm replica; test-only ledger cap for load tests; idle cost in the Economics gate. |
| R62 (F6) | Medium, ignored existing controls | `llm_job_budget_available`, job dedupe (`20260908000002`) and the FAIL_CLOSED buckets were not mentioned; `openai_client.py:75` sets no timeout, default SDK retries, and no output-token cap. | §9 builds on the existing layers; the controller ledger also meters ingestion; A0.1 sets `timeout`, `max_retries=0`, `max_output_tokens`; new AI buckets go on FAIL_CLOSED. |
| R63 (F7) | Medium, wasted spend | The 150-surfaced-members cap and per-job rescan caps were applied after assessment, discarding paid work. | §9: checked at admission (remaining allowance ≥ result count) before any reservation. |
| R64 (F8) | Medium, latency | Region is answered in the repo (`vercel.json` fra1; Supabase London), and each authenticated page makes ≥ 3 sequential Frankfurt↔London Auth/DB hops (`proxy.ts:52`, `guard.ts:92`, then `is_admin` + profile). | §10.1: measured experiment — fra1 vs lhr1, `getClaims()` in the guard, one cached per-request lookup (built in programme B26). |
| R65 (F9) | Low, missing context | C2 (0% errors at 500 VUs, knee 250–500) was omitted beside C6 (84.79% failures); both local, C6 with 20 reused identities. | §10.1 cites C2, C5 and C6 together and explains the difference; Medium compute and the programme's E1b gates replace ad-hoc comparison. |
| R66 (F10) | Medium, unnecessary complexity | Clustering gives no retrieval benefit at ≤ ~280 messages per member per week; keyword + vector search over the source archive covers it. | §5.1: clusters/SLM regrouping deferred, shipped only if evals show misses; typed graph and source archive kept. |
| R67 (F11) | Low, unnamed surface | `/foundry-ai` already exists as a "Coming soon" page with a sidebar entry. | §12 names it; the placeholder stays while all flags are off. |
| R68 (F12) | Medium, drift risk | Limits were scattered across ~10 sections. | Appendix A "Launch tunables" with a section link per value. |
| R69 (F13) | High, test coverage | One Desktop Chrome project, no mobile; no spec for `/admin/graduates`, `/admin/reports`, `/admin/community`, admin `/…/new`, listing edit pages, `/committee`, `/community/mine`, `/foundry-ai`; CV upload never driven through the UI; axe on ~14 pages. | New §14.4 full-functionality Playwright audit; UI gate references it; one line in the eval plan. |
| R70 (F14) | Low, citations | `config.py:153` → `:114`; `worker.py:368` → `:366–385`; bare intake filenames lacked their path. | Corrected here (R19, R21) and in AI-plan §1. |
| R71 (F15) | High, current | Live privacy copy (`privacy/page.tsx:76-80`) says CV text is never stored or sent to a third party; the worker stores `raw_text` and sends it to OpenAI. | §§13–14 "Now, independent of AI" step ahead of A0; legal wording from the owner. |
| R72 (F16) | High, contradicts owner rule | Connect was placed on every result card and on "Posted by", against the 2026-09-23 decision that Connect lives only in the profile dialog. | §§1, 2, 7, 12, A1.3, A3: View profile on cards/Posted-by; one ConnectControl per open dialog. |
| R73 (F17) | High, exposure | Supabase default privileges give `anon`/`authenticated` EXECUTE on every new `public` function; `revoke … from public` is not enough (`20260608000001`). | §10: executor RPCs in non-exposed `ai_private`; revoke from `public, anon, authenticated`; in-body role guard; `has_function_privilege` tests. |
| R74 (F18) | High, privilege | `admin_create_opportunity` sets `posted_by = auth.uid()`, so admin-posted jobs would give admins directory-wide candidate search. | §1 owner decision: excluded via a creation-source marker (not "poster is not admin", since all committee members will be admins); negative and positive tests. |
| R75 (F19) | Medium, privacy | PostHog (`identify(user.id)`, `capture_pageview`) is an unlisted processor; turn/conversation IDs in URLs would reach it; no `before_send` exists. | §13: add PostHog to processor/ROPA rows; enum-only AI events; `before_send` strips IDs from `/foundry-ai` URLs. |
| R76 (F20) | Low, false assumption | `ai_enabled` was referenced as existing; it is nowhere in code or migrations. | §9: new flags following the `connections_enabled()` in-RPC pattern. |
| R77 (F21) | Medium, migration trap | §7.2 rewrites every listing read RPC; the project has hit dead-overload and return-type traps twice. | §7.2: copy latest signature, drop before changing return types, re-grant, live `aclexplode` dump after migrating. |
| R78 (F22) | Low, owner preference | §12 asked for long inline explanations; the owner wants one sentence + a link. | §12 copy rule: one sentence + `/ai-notice` link. |
| R79 (F23) | Low, recurring UI bug | New controls risk shipping as bare text. | §12: visible border on every control; checked in the §14.4 visual pass. |
| R80 (F24) | Low, CI time | The suite is serial and CI E2E jobs are time-capped. | §14.4: record runtime at each gate; split AI specs only at ~75% of the cap. |
| R81 (F25) | High, current | The CV worker connects as `postgres` via the session pooler (full access incl. `auth.users`), and its DSN has no `sslmode`. | §§10, 14 "Now, independent of AI": scoped `cv_worker` login + RLS + `sslmode=require`; owner switches the VM env. |
| R82 (F26) | Medium, ambiguity | §6 extended the ingestion worker for projection/JD jobs while §10 isolated AI from it. | Owner: the existing CV worker does projection/JD work under `cv_worker`; ACA runs turns only (§§1, 6, 10). |
| R83 (F27) | Low, unspecified mechanism | "Controlled rollout" had no mechanism. | Owner: no pilot list; all-or-nothing flags after the gates (A1.5). |
| R84 (F28) | Medium, cold start | Opt-in discovery means early recruiter searches hit a tiny pool. | Owner: launch together; honest low-result copy; opted-in count on the admin dashboard. |
| R85 (F29) | High, access change | Enforcing audiences hides jobs from unknown-status members, contradicting "no current member loses access". | Owner: enforce immediately; §1 corrected; confirm-status prompt; education question in intake. |
| R86 (F30) | High, deletion | Delete RPCs run in a fixed order with some `ON DELETE RESTRICT` FKs; new AI tables could block deletion. | §11: cascade from member/opportunity FKs or join every delete RPC; tests for all four delete paths. |
| R87 (F31) | Medium, unowned jobs | No runner was named for purge, expiry, reaper or reconciliation. | §9: pg_cron for DB-only work (works when ACA is down); executor reaps its own leases; cron check-ins alert when stopped. |
| R88 (F32) | Medium, test harness | E2E needs the Python executor running. | §14.4: Playwright `webServer` starts it with the fake provider; CI sets up Python. |
| R89 (F33) | High, missing environment | The plan assumed a production-like staging project that will not exist. | §10.1 defines staging: local/ephemeral runs plus the pre-launch prod window before launch; a real staging project for any capacity change after launch. |

## Regression scenarios the revised design must pass

1. “Must use PyTorch” never returns TensorFlow-only as meeting that requirement; “either framework”
   remains an OR; “no PyTorch experience” is not evidence of PyTorch proficiency.
2. “Deep learning, and explain Pythagoras” produces no explanation, retrieval or candidate assessment
   until the safe criteria are explicitly confirmed. “People who teach Pythagoras” remains usable.
3. Opt-out during an assessor call blocks publication; the old worker/cache cannot restore private
   evidence; replay and another replica honour the withdrawal immediately on their next read.
4. Identical source upload after a redaction-policy change does not reactivate the old unsafe profile.
5. Twenty concurrent turns, late provider responses and cross-midnight retries never free reservations
   for possibly billable work or bypass the monthly ceiling.
6. A direct service RPC with another member ID cannot select that identity, fetch arbitrary CV cards,
   forge an admitted turn, write global assessments or bypass the posted-job ownership check.
7. A candidate's evidence score does not change because an unrelated candidate was added or a different
   recruiter clicked Shortlist. Missing CV/GitHub evidence is not phrased as proven lack of ability.
8. Two browser tabs cannot overwrite conversation criteria or remap “#3”; a disconnect does not create
   a second paid run. Old quotes do not silently reattach to a new CV.
9. A recruiter job that expires before cron, is withdrawn or has an unapproved edit never uses those
   unavailable requirements; an event/grant cannot masquerade as an eligible job.
10. Ten visible result cards render View profile only (no ConnectControl per card, R72), so they
    create no duplicate accessibility IDs and no connection RPC calls; opening one profile makes a
    single connection-state RPC. View profile opens the existing supported UI, and Posted by keeps
    existing Apply intact.
11. Graduate faculty qualify for graduate jobs; enrolled graduates qualify for either audience once.
    Direct detail/bookmarks/community posts cannot reveal jobs outside the viewer's eligibility.
12. At 168 hours an old chat source cannot re-enter context through a summary, active SearchSpec,
    cache or late SLM worker. Retained unclustered messages remain retrievable before expiry.
13. Changed idempotency keys, jobs/modes/tabs and Redis outages cannot bypass aggregate DB quotas;
    transport interception finds no paid call without prior reservation, including refused prompts.
14. Saved findings expire in seven days without renewal by viewing/reuse; opt-outs vanish immediately.
    Re-scans pick up existing members' new consent/evidence, coalesce duplicates and disclose backlog.
15. Broad Deep Learning evidence earns broad-criterion credit without inventing PyTorch; explicit
    tool requirements retain their meaning. Alias/ancestor repetition cannot increase relevance.
16. Mentor seekers are not labelled mentor offers; generic availability is not employment consent;
    job preference mismatches do not alter capability scores or silently gate Apply.
17. A source-junction-only edit invalidates the projection; new private preference columns cannot
    be read through the directory path; graduation transition does not invoke account cleanup.
18. An eval run with skipped mandatory suites, uncalibrated judge or unavailable ground truth cannot
    be labelled passed; model/prompt/taxonomy changes require held-out evaluation again.
19. A turn that waits in the queue for longer than 60 seconds still runs under its own authority
    (the turn row, lease and fencing token), and a stale lease holder cannot publish (R57).
20. Reopening saved results makes zero provider calls and holds no long-lived function open (R58).
21. Once the surfaced-members cap is reached, the next request is refused at admission before any
    money is reserved (R63).
22. Parallel assessor batches respect both the active-turn cap and the in-flight provider-request
    cap and finish inside the 45-second deadline; a retry is never launched without a full attempt's
    time remaining (R59).

## Product recommendations made explicit

- One posting per recruiter thread, with multi-turn refinement in the first release.
- Typed memory graph in Postgres: conversation criteria, reviewed concepts, source-backed evidence
  and assessment dependencies; bounded SearchSpec and caches remain its execution interface.
- Separate permission to recommend someone and to show their CV quotations.
- Owner follow-up: full removal when opting out. Compulsory participation was raised as a question,
  not selected; voluntary AI discovery is recommended independently of upload requirements.
- Owner confirmed Students/Graduates/Both jobs, including graduate applicants. Use independent
  education facts across all affiliations, enforce audience across all posting reads/actions,
  and constrain recruiter refinement to the posting. Keep optional nonstudent CV ingestion.
- 40 runs per rolling day, 5/minute, with $5/$10/$15 daily matching caps by rollout stage, all
  subject to measured cost. These are suggested limits, not promised daily capacity.
- No automatic criterion relaxation, outreach, application or candidate suppression from fatigue.
- Owner selected a week: rolling seven-day source history and derived chat memory, with immediate
  delete/forget controls. Optional SLM clustering runs off the chat path only if measured benefit
  justifies its cost; no indefinite saved-chat-preference exception.
- Saved recruiter findings also last seven days. Manual Check for new matches reuses current
  evidence assessments with bounded work, live permission checks and explicit scan coverage.
- Abuse testing covers every registered limit and paid/read/background path, actual concurrent DB
  admission, fault injection and provider transport assertions; no universal security guarantee.

## Review limits and next gate

This was source/design review, not a penetration test, legal opinion or production configuration
audit. No application tests were run because no application code changed. Documentation checks
verify links/structure/consistency, not that the future controls work. Numerical quality, latency
and capacity gates are provisional targets to validate on local synthetic fixtures.

Read the revised plan, then implement A0 followed by A1. The plan retains voluntary discovery;
making participation compulsory would be a new product/legal decision, not an assumed instruction.
Legal/provider configuration sign-off gates member rollout; local implementation can proceed once
the corrected design is accepted without treating every operational choice as another approval.
