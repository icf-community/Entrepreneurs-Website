# Foundry launch-readiness programme: AI plan amendments, current-app fixes, full audits, production rollout and final test pass

## Context

This started as an audit of `AI-plan.md`, `AI-evaluation-plan.md` and `AI-plan-review.md` (Part A).
The owner then widened it (2026-09-28):
- find gaps in the current codebase and in the plans;
- plan full scalability, security, UI/UX and other audits;
- plan how everything gets into production;
- add skeletons, spinners and smoother pending states;
- propose nice-to-have features;
- once everything is built, test all of it with Playwright plus full k6 load, concurrency and stress runs.

**Owner decisions (2026-09-28):**
- **Launch timing:** launch is delayed until the whole programme is done. The ~09-30 date is dropped.
  - **All three AI modes (recruiter → network → opportunities) ship and pass their gates before the public launch**, so the final E4/E5 pass covers them (owner-confirmed 2026-09-28).
- **k6 target:** run against **prod, before launch only**. The safeguards are in Part E3; after launch, any retest needs staging.
- **Extras:** uptime monitor + alerts (Sentry, email to the owner only), self-serve data export, in-app notifications, and an incident banner managed from the admin panel. A toast system is included regardless.
- **Observability:** in-house only, with no new SaaS. Sentry and PostHog stay; AI tracing lives in our own Postgres (G9).
- **People:** no second-person access or handover work; the society's Notion page covers it. The whole committee becomes admins and runs an acceptance test (E5b) before public sign-ups.
- **Placeholders:** hide `/messaging` from navigation now and restore it when messaging is built. The `/foundry-ai` placeholder stays until the AI modes ship, then it becomes the AI page.

**I can't promise zero gaps, and nobody honestly can.** What the programme does promise is that every
area has a named audit, written evidence and a pass/fail gate, so unknowns turn into checked results.

**Execution order:**
0. **Part 0: graphify first.** Refresh the graph and install auto-updates (below).
1. Part A: AI doc amendments.
2. Part B: current-app fixes.
3. Part C: loading and pending UX.
4. Part F: extras.
4b. Part G: observability refresh (Sentry, PostHog, cron/queue health, AI tracing).
5. Part D: audits and their fixes.
6. AI build A0–A3, per the amended AI-plan.
7. Full local test pass.
8. Part E: prod rollout, the pre-launch prod Playwright + k6 window, the committee acceptance test, go/no-go.
9. Launch.

Each part ends with a verify step. `tasks/todo.md` becomes the checklist (see Verification for the loop and the stop-and-ask rules).

---

# Part 0 — graphify: fresh graph, used first, never stale

Current state: `graphify-out/` is gitignored and local to this machine. No git hooks are installed, so the graph only refreshes when someone remembers. The installed skill (0.9.50) is behind the package (0.9.53).

1. `graphify install --platform claude` updates the skill to match the package.
2. `graphify update .` rebuilds the code graph from the current working tree (AST, no API cost). Then `graphify check-update .` shows whether doc/markdown nodes need semantic re-extraction. If they do, run `/graphify . --update` for the changed docs (AI-plan, audits, `after-supabase-pro.md`, etc.).
3. `graphify hook install` adds post-commit and post-checkout hooks, so every commit or branch switch rebuilds the code graph automatically. Confirm with `graphify hook status`.
4. **Working rule from here on:**
   - Every codebase question starts with `graphify query` / `explain` / `path`. grep and Read come only afterwards, to confirm or edit specific lines.
   - After every batch of code edits (before each commit), run `graphify update .`. The hook covers commits.
   - At the end of each phase, run `graphify check-update .` plus a semantic `--update` if docs changed.
   - Subagents are told the same in their prompts.
5. **Verify:** a `graphify query` for a symbol added in this session returns it. Hook status shows installed.

---

# Part A — AI plan amendments (unchanged from the earlier planning rounds)

**How I checked:** I read all three plans in full, then compared their citations and assumptions
against the source using graphify, `worker.py`, `openai_client.py`, `config.py`, `ratelimit.ts`,
`opportunities.ts`, `ConnectControl.tsx`, `guard.ts`, `lib/supabase/proxy.ts`, `vercel.json`, the
C2/C6 audits, the compliance docs, the migrations, the Playwright config and all 16 specs.

**Verdict:** the plans are thorough on privacy and abuse, and their code citations are mostly
accurate. The issues I found are internal contradictions left over from earlier revisions,
arithmetic that doesn't add up, over-provisioning compared with the spend caps, existing controls
and audits the plans ignore, and missing Playwright coverage.

Owner decisions made during planning:
- **Clustering:** deferred. The owner left the call to me.
- **Privacy-page fix:** make it an immediate step.
- **F18 admin-created jobs:** nobody gets recruiter mode on them in v1. No "on behalf of" flag.
- **F16 Connect:** dialog-only, with no exception for AI results.
- **F19/F23/F24:** use the smaller versions. Details are in the table below.
- **F25 worker login:** plan only for now, with no code in this change.
- **F26 indexing:** the existing CV worker builds member/job search projections. ACA runs turns only.
- **F27 rollout:** no pilot list. Flags are all-or-nothing.
- **F28 cold start:** recruiter mode launches together with the opt-in controls, accepting thin early results.
- **F29 audience cutover:** enforce immediately. Unconfirmed members see no audience-restricted jobs until they confirm.

## Findings (verified in source) and the fix for each

| # | Finding | Evidence | Fix (doc and section) |
|---|---|---|---|
| F1 | **Contradictory security model.** §10 steps 1–4 have the AI runtime consume a 60-second opaque capability. But the preferred ACA executor has no ingress and claims work from a Postgres queue, so it never receives one. A capability would also expire while its turn waits in the queue. | AI-plan §10 vs §10 "no public ingress" and §10.1 | Rewrite §10 steps 1–4 for the no-ingress design. The browser → Vercel → user-session RPC admits the turn and inserts it (actor = `auth.uid()`), and that turn row is the authority. The executor uses `ai_claim_turn()`, which returns a lease and fencing token. Every service RPC takes `(turn_id, lease_token)` and derives the actor from the turn. Keep opaque capabilities only as the design to use if HTTP ingress is ever added. Update §9's "consume/admit" wording and the Access/privacy gate row to match. |
| F2 | **Streaming vs polling contradicts itself.** §9 prefers an event stream, §10 says poll unless measured, §10.1 prefers a stream again. On Vercel, SSE keeps a billed function open for the whole turn and still has to poll Postgres. Supabase Realtime isn't used anywhere in `frontend/src`. | AI-plan §§9, 10, 10.1 | One default for v1: client polling with one request in flight, conditional revision/ETag reads, backoff with jitter (about 1s → 2s → 4s, capped), and a pause on hidden tabs. SSE is out of v1. Replace "live streams/member" limits with poll limits. |
| F3 | **The 45-second deadline doesn't fit sequential calls.** One interpreter call plus four assessor calls at 20s each, with retries, can't fit in 45s. The "50 active turns" figure is also used as if it were the provider-concurrency cap, but 50 turns × 4 batches means up to 200 requests in flight. | AI-plan §9, §14 Load gate | State the order: interpret → retrieve → up to 4 assessor batches **in parallel**. Retry only if the remaining deadline still covers a full attempt timeout. Use two separate caps: active turns and in-flight provider requests. Starting ceiling = min(50, derived from measured RPM/TPM). |
| F4 | **The "warm AI result p95 <2s" target can't be met for natural-language turns.** Every natural-language message pays for an interpreter call (§9). | §14 Load gate | Split the target. Paths with no provider call (chip rerun, replay, reopen) stay at p95 <2s. A natural-language turn with all assessments cached gets its own provisional p95 target (<6s), to be measured. |
| F5 | **Infrastructure is sized beyond the spend cap.** The $5/$10/$15 daily caps (and the spec's "low search volume") allow tens to low hundreds of turns a day. The plan still provisions for 50 concurrent turns with two always-warm ACA replicas. | §§9, 10.1; `cv-matchmaker-spec.md` "Scale" | Say plainly that launch throughput is limited by spend, not compute. Derive turns/day from measured cost per turn. Load tests use a staging-only ledger cap. Start ACA at **1** warm replica: the durable queue turns a replica restart into a delay, not lost work. Move to 2 only when measured SLO/availability justifies it. Add ACA idle cost to the Economics gate. |
| F6 | **Existing spend controls are ignored.** The plan never mentions `llm_job_budget_available` (30 LLM jobs per member per day), job dedupe (`20260908000002`), or the FAIL_CLOSED buckets `githubConnect`/`githubShowcase`. The current OpenAI client sets no timeout and leaves SDK retries at the default. No call sets a max output token limit. | `openai_client.py:75`; `ratelimit.ts` FAIL_CLOSED list; memory of the three-layer design | §9 builds on the existing layers. The job budget stays as the ingestion per-member gate. The controller-wide ledger must also meter ingestion calls, or the "controller-wide total" isn't enforceable. A0.1 becomes concrete: `OpenAI(timeout=…, max_retries=0)` plus `max_output_tokens` on extraction and summary calls. Any Upstash bucket used for AI goes on FAIL_CLOSED (`ratelimit.test.ts` already forces every bucket to be classified), with the DB still the authority. |
| F7 | **Paid work can be thrown away.** The 150-distinct-members-per-viewer-per-day cap (and the per-job rescan caps) are applied after assessment, so paid results can be discarded. | §9 | Check the remaining allowance (≥ result count) at admission, before any money is reserved. |
| F8 | **The region question is answered in the repo, and the auth path has avoidable round trips.** Functions are pinned to `fra1` in `frontend/vercel.json` (also recorded in compliance docs 01/03). Supabase is in London. Every authenticated page calls `getUser()` in the proxy (`lib/supabase/proxy.ts:52`), again in the guard (`lib/auth/guard.ts:92`), then `is_admin` and the profile read. That is at least three sequential Frankfurt↔London round trips before any page data. | files cited | Rewrite §10.1/§14.3 as a concrete A0 experiment, measured before and after: (a) fra1 vs lhr1 in staging; a move means editing `vercel.json`, compliance docs 01/03 and any location copy; (b) `getClaims()` in the guard (local JWT verification with asymmetric keys; the status check stays in the DB); (c) caching the per-request auth lookup. |
| F9 | **The earlier C2 audit is omitted.** C2 found 0% errors at 500 VUs, rendering-bound, with the knee between 250 and 500. C6 found 84.79% failures. Both runs were local, and C6 was authenticated with 20 reused identities. The owner's 50/100 k6 result needs to be compared with the right one. | `docs/audits/C2…`, `C5…`, `C6…` | Cite C2, C5 and C6 together in §10.1 and explain why they differ. |
| F10 | **Clustering has no retrieval benefit at this size.** A 7-day window at 40 runs/day is at most ~280 messages per member. Owner-scoped keyword and vector search over the source archive covers that. | §5.1, A0.3 | Keep the typed criteria/concept/evidence/dependency graph and the source archive. That is where reuse, cost savings and provenance come from. Move clusters and small-model regrouping to a deferred step that ships only if evals show retrieval misses. Update A0.3, the Memory graph gate row and the eval plan's clustering ablation. |
| F11 | **The page that hosts the feature isn't named.** `/foundry-ai` already exists as a "Coming soon" page with a sidebar entry. | `frontend/src/app/foundry-ai/page.tsx`, `Sidebar.tsx:183` | Name it in §12. When all flags are off it keeps the current placeholder. |
| F12 | **The limits are scattered across about 10 sections.** Atoms, groups, 200/20/10, 5/min, 40/day, 45s/20s, 4 KiB, 600 chars, 7/30 days, turn caps, $ caps, read limits. Implementers will drift. | whole doc | Add one "Launch tunables" table as an appendix. Values are copied as written, only updated for F3–F5, with a section link for each. |
| F13 | **Playwright coverage gaps.** There is one Desktop Chrome project and no mobile. No spec visits `/admin/graduates` (a destructive bulk delete), `/admin/reports`, `/admin/community`, the admin `/…/new` forms, `/opportunities/[id]/edit`, `/vcs/[id]/edit`, `/committee`, `/community/mine` or `/foundry-ai`. CV upload → processing → ready is only seeded, never driven through the UI. `a11y.spec.ts` covers about 14 pages. | `playwright.config.ts`, route/spec scan | New §14.4 in AI-plan (below), an update to the UI gate row, and one line in the eval plan. |
| F14 | **Some citations are wrong.** `config.py:153` should be `:114` (the file is 122 lines). `worker.py:368` should be `:364–385`: embedding happens via `normalise_skills`/`chunk_and_embed` inside `with connection()`. The bare `IntakeFlow.tsx`/`screens.tsx` references should be `frontend/src/components/intake/…`. | source | Correct them in AI-plan and in review R19/R21. |
| F15 | **The live privacy copy is false now, separately from AI.** `privacy/page.tsx:76-80` says extracted CV text is "never stored" or sent to a third party and that matching is string-only. The worker stores `raw_text` (`worker.py:314`) and sends it to OpenAI at `:342`, `:361` and `:385`. | source | Per the owner: a new **"Now, independent of AI"** step ahead of A0 in §14 and §13, plus a `tasks/todo.md` item. The legal wording stays with the owner/reviewer; I'm not writing legal copy. |

### Second pass: gaps against existing owner decisions and project-specific traps

| # | Finding | Evidence | Fix |
|---|---|---|---|
| F16 | **Contradicts a locked owner rule.** The owner decided on 2026-09-23 that Connect/Pending lives *only* in the member profile dialog, not on cards. AI-plan §12 puts Connect on every result card ("ten instances in a turn"), and §2/§12 add Connect to "Posted by" on opportunity cards. | owner memory for Connections; AI-plan §§2, 12, review R24 and scenario 10 | Result cards and Posted-by show **View profile** only. Connect stays inside `MemberDialog`. This also removes the "40 connection RPCs for 10 cards" problem from R24 and scenario 10. Reword those, and the §14 UI gate, to "one ConnectControl per open dialog". |
| F17 | **The executor's RPCs would be callable from the browser.** §10 (around AI-plan:992) already specifies a NOINHERIT `ai_service` login with enumerated EXECUTE grants, and says to audit default grants. What it doesn't cover is where the functions live. In this project, `anon` and `authenticated` can execute every function in `public` through Supabase default privileges, whatever grants `ai_service` holds. That was proven live, and `revoke … from public` alone is not enough. | memory on function-grant default privileges; migration `20260608000001`; `server/app/db.py:30` (the existing worker connects directly via psycopg, not PostgREST) | The executor connects directly to Postgres as `ai_service`, like the existing worker. Its RPCs live in a schema PostgREST does **not** expose (for example `ai_private`), so browsers can't reach them at all. As defence in depth: `revoke execute … from public, anon, authenticated`, and add an in-body role guard. Negative tests use `has_function_privilege`, because local CLI 2.116 segfaults on call-and-catch. |
| F18 | **Admin-created jobs make the admin the recruiter.** `admin_create_opportunity` sets `posted_by = auth.uid()`. Every job an admin posts for a company would give that admin candidate search over the whole directory. | `20260610000000_admin_create_require_profile.sql:51-71` | **Owner decision (2026-09-27):** candidate search on admin-created jobs doesn't exist in v1, and there is no "on behalf of" flag. Record this in §1. Recruiter-mode eligibility excludes jobs created through `admin_create_opportunity`, using a **creation-source marker** on the row. The alternative "poster is not an admin" check is ruled out: every committee member will be an admin, and a job they post through the normal member flow must still count. Add negative and positive tests: an admin-created job is refused, while an admin's own member-flow job is allowed. |
| F19 | **PostHog isn't listed as a processor.** It calls `identify(user.id)` and has `capture_pageview: true`, so page URLs go to PostHog with the member's identity. The plan already bans criteria and snippets from URLs (AI-plan:1182). The remaining leak is opaque conversation/turn IDs tied to a member. The frontend has no `before_send` or sanitiser today. | `PostHogProvider.tsx:35-59`, `analytics.ts:34` | Small fix: (1) add PostHog to the §13 processor/ROPA rows; (2) AI custom events carry only bounded enums, never criteria, candidate IDs or scores; (3) a PostHog `before_send` strips conversation/turn IDs from `/foundry-ai` URLs. |
| F20 | **The kill switch doesn't exist yet.** The plan refers to "the operator's `ai_enabled` kill switch" as if it existed, but it appears nowhere in the code or migrations. The existing flag pattern is `connections_enabled()`, gated in-RPC. | grep | State that `ai_enabled` and the per-mode flags are new, and follow the `connections_enabled()` pattern. |
| F21 | **Risk of recreating dead overloads.** §7.2 rewrites every listing read RPC for the audience change. This project has hit "dead overload" and "return type" traps twice. | tasks/lessons.md, memory on recreating functions | Add to §7.2: copy the **latest** signature and return shape, `drop` before changing a return table, and run a grant dump (`aclexplode`) after migrating, since file-based audits miss prod-only objects. |
| F22 | **Member-facing copy runs against the owner's stated preference.** The owner finds member-facing text over-explained and wants "one sentence + a link". §12 asks for a first-use explanation, a persistent disclaimer, source/expiry explanations and more. | memory on concise UI copy | §12: every explanation is one sentence plus a link to `/ai-notice`. Put the detail on that page, not inline. |
| F23 | **Controls may ship without a visible shape.** Chips, the mode selector, Required/Preferred toggles and the rail are new controls. A recurring bug here is shipping them as bare text. | memory on buttons needing a visible shape | §12: every control needs a visible border (`--color-border-strong`). Check this in the §14.4 visual (Playwright MCP) pass, not as an automated CSS assertion, which would be brittle. |
| F24 | **The Playwright audit could slow CI.** The suite is serial with `workers: 1`, and CI E2E jobs are time-capped (commit 571306e). The AI specs don't exist yet, and each extra CI job boots its own Supabase, the flakiest CI step. | `playwright.config.ts` | Don't split now. §14.4 records E2E job runtime at each phase gate. Move AI specs to their own job only when the E2E job reaches about 75% of its cap. |

### Third pass: implementation gaps

| # | Finding | Evidence | Fix |
|---|---|---|---|
| F25 | **The existing CV worker runs as a full-privilege login.** `DATABASE_URL` is the `postgres` role through the session pooler, so the worker can read and write every table, including `auth.users`. The plan forbids the AI service from reusing this "broad worker DSN" (§10) but never fixes the worker. Its real footprint is small: `jobs`, `cvs`, `cv_profiles`, `cv_chunks`, `cv_skills` (read), `member_skills`, `github_connections`, plus `update_cv_currency()` and `pgp_sym_decrypt`. | `server/README.md:69`; `infra/vm/bootstrap-worker.sh:105-116`; SQL in `server/app/worker.py`, `cv_pipeline.py` | **Owner: plan only.** Add a step to "Now, independent of AI" plus a todo item. Create a `cv_worker` login (NOINHERIT, NOBYPASSRLS), grant it only the tables/columns and functions above, and add `to cv_worker` RLS policies on those tables. Use the same role locally, so worker tests catch a missing grant. Verify the session pooler accepts the custom role first (the §10 pooling proof). Owner steps: set the password and switch `/etc/foundry/worker.env`, with the old DSN kept for rollback. Update `server/README.md` and `bootstrap-worker.sh`. The F26 projection jobs extend this role's grants explicitly. |
| F26 | **It's unclear which process runs background projection/JD work.** §6 extends the ingestion worker's `_claim_job` for projection/JD jobs. §10 isolates AI from that worker. The owner decides grants and keys. | AI-plan §6 line 517, §10 line 965 | **Owner: the existing CV worker** builds `member_search_docs`, JD requirements and their embeddings (under the scoped `cv_worker` role and the metered ledger). The ACA executor only runs turns plus query embeddings, and never reads raw CV/GitHub sources. State this in §6, §10 and A0.4. |
| F27 | **A "controlled rollout" is named but no mechanism is specified.** | AI-plan §14 A1.5 | **Owner: no pilot list.** Reword A1.5: rollout means per-mode flags on for everyone, after the gates pass in staging. Flags remain the rollback. |
| F28 | **Discovery defaults to opt-in, so early recruiter searches hit a tiny pool.** | AI-plan §1 | **Owner: launch together.** The empty/low-result state says plainly that few members have opted in so far, without naming anyone. Track the opted-in ready-projection count on the admin dashboard. |
| F29 | **Enforcing audiences makes jobs vanish for unconfirmed members.** Unknown education status satisfies no audience (§7.2), and every job will have one. This contradicts "no current member loses access" (§1 line 105). | AI-plan §§1, 7.2 | **Owner: enforce immediately.** Record it in §1 and correct line 105's claim. To keep the impact small, add the education question to intake, so new members are never unknown. Unconfirmed members see a single "Confirm your status to see jobs" prompt, not an empty board. Pre-launch prod is admin-only, so few existing members are affected. |
| F30 | **Account deletion may break.** `delete_my_account` and the admin delete RPCs delete rows in a fixed order, and some FKs are `ON DELETE RESTRICT`. New AI tables referencing profiles/opportunities could block deletion. | `20260529000004_delete_my_account_full_cleanup.sql`, `20260529000007_admin_delete_user_rpcs.sql`, `20260917000009_…` | §11: AI tables use `ON DELETE CASCADE` from member/opportunity FKs, or are added to every delete RPC. Test that self-delete, admin delete, job delete and graduate delete all succeed with AI rows present. |
| F31 | **No runner is named for the hourly purge, expiry, reaper or reconciliation.** | AI-plan §§5.1, 9 | Follow the project pattern: pg_cron (used by 10 migrations) runs DB-only purge/expiry and reconciliation, so they work when ACA is down. The executor reaps its own expired leases. |
| F32 | **E2E needs the Python executor running.** | §14.4 | Playwright `webServer` also starts the executor with the fake provider. The CI E2E job sets up Python. |
| F33 | **The AI plan assumes a staging environment that won't exist.** §§10.1 and 14 (A0.5, Load gate) require "production-like staging". The owner chose to test on prod before launch instead (2026-09-28). | AI-plan §§10.1, 14; Part E1/E3 | Wherever "staging" appears: before launch, it means local/ephemeral runs for correctness and the fake-provider 500-burst, plus the Part E3 pre-launch prod window for hosted capacity. After launch, any capacity-affecting change (including raising the concurrency ceiling) needs a staging project first. F27's "gates pass in staging" changes to match. |

**Not audited line by line:** `AI-data-audit.md` and `docs/ai-migration-inventory.md`, which the plans treat as authoritative, and the live production state (grants, regions, tiers, whether migrations have been applied). Repository review cannot settle those. Before A0, run a live `aclexplode` grant dump and check the dashboard region and tier.

## Edits to make

1. **`AI-plan.md`**
   - Add a one-paragraph "Audit 2026-09-27" note to the header block, pointing to the new review rows.
   - Apply the F1–F12, F14–F33 changes in the sections listed above. Keep edits surgical and don't rewrite the surrounding text.
   - F16 touches §2 (line ~137, Posted-by avatar/Connect), §7 (line ~565, cards keep Apply and Connect), §12 (lines ~1189 and 1194–1197) and A1.3 (line ~1308).
   - Record every owner decision above in §1: F16, F18, F26–F29, clustering deferred.
   - Add F25 to §13/§14 as a "Now, independent of AI" step, alongside F15.
   - Add the **§14.4 Full-functionality Playwright audit** described below.
   - Add the "Launch tunables" appendix.
2. **`AI-plan-review.md`**
   - Add rows **R57–R89**, one per finding F1–F33, in the existing Severity / Finding / Correction format.
   - Add a short header line for this pass.
   - Add regression scenarios 19–22:
     - 19: a turn queued longer than 60s still runs under its own authority.
     - 20: reopening saved results makes zero provider calls and holds no long-lived function.
     - 21: once the surfaced-members cap is hit, the request is refused before any reservation.
     - 22: parallel assessor batches respect both caps and the 45s deadline.
3. **`AI-evaluation-plan.md`**
   - Clustering becomes an optional ablation rather than a planned component (§7).
   - Add a browser-layer line: rendering of eligibility, score labels and refusals is checked by the §14.4 Playwright suite, not by service adapters.
   - Adjust the O12 wording to the split latency targets.
4. **`tasks/todo.md`**: replace the stale "Launch plan (target ~2026-09-30)" header with a **Launch-readiness programme** checklist:
   - Parts 0 and A–G, in execution order, one checkable item per B/C/D/E/F/G entry (including F-x4 and E5b), each with its verify line;
   - the F15 privacy-copy fix;
   - the F25 scoped `cv_worker` login (plan only);
   - the AI A0–A3 items, kept and cross-referenced;
   - B17: tick C1–C3 with the 2026-09-24 ship date;
   - existing owner items O1–O3, L1 and E1–E3, moved under E6 go/no-go;
   - the unselected nice-to-haves under Post-launch.

   The detailed programme text above is also saved as `docs/launch-readiness-programme.md`, so it lives in the repo and not only in this plan file.
5. **Carry-over sweep, so nothing from earlier plans is lost.** Every unchecked box in these sources is mapped to a programme item, or closed with a written reason:
   - the old `tasks/todo.md` (including S4 and the E1–E3 email move);
   - `after-supabase-pro.md`;
   - `scalability-audit.md`;
   - `cv-matchmaker-spec.md`;
   - the three AI docs;
   - the leftover items from the 2026-09-11 plan (B2.8/B3.4/B3.6/C2 re-measure).

   The mapping table goes at the bottom of `docs/launch-readiness-programme.md`. **Verify:** every open item in those files has either a programme ID or a reason it was closed.
6. **Record this session's corrections** in `tasks/lessons.md`, per CLAUDE.md §6:
   - load/perf metrics stay local, never in prod;
   - measurement is for my own use, so no visualisation;
   - launch compute is Medium, and anything bigger needs owner cost approval;
   - capacity is gated 250 first, then 500.

   Also update the saved memory: the launch plan dated 2026-09-23 has been replaced by this programme.

### Content of the new AI-plan §14.4: full-functionality Playwright audit

- **When:** before A0 changes existing pages (baseline), at the end of each phase A0–A3, before each mode is enabled, and before any concurrency-ceiling increase.
- **Environment:**
  - A freshly rebuilt production build (`pnpm build` in the same script) against an ephemeral local Supabase, with a deterministic fake provider.
  - Playwright `webServer` also starts the Python executor, and CI sets up Python (F32).
  - Never production, and never `.env.local`.
  - Live-provider smoke runs stay in the eval plan's cost-capped mode.
- **Coverage matrix, checked into `frontend/e2e/`:**
  - Every `src/app/**/page.tsx` route × every role that can reach it. Roles: logged-out, pending, rejected, student, graduate/alum, recruiter with an eligible job, admin, AI-operator.
  - A unit test fails when a new `page.tsx` has no matrix entry.
  - Close the current gaps listed in F13 first. Use a throwaway fixture for `/admin/graduates`, since it deletes accounts.
  - Drive CV upload → processing dialog → ready through the UI.
- **Devices and accessibility:**
  - Add a mobile Playwright project (phone descriptor).
  - Check keyboard-only paths, 200% zoom/reflow and reduced motion.
  - Run axe on every page and on every AI state.
  - Enforce 44×44 primary touch targets.
- **AI flows:**
  - Each mode's happy path and refinement (Deep Learning → then chess), the mixed-prompt confirmation, and off-task refusal.
  - Budget exhausted, queue busy, outage, partial result, expiry, forget/delete, and both consent toggles.
  - Recruiter-mode gating. A Students/Graduates/Both job is hidden from ineligible viewers across list, detail, home, bookmarks and community posts.
  - Stable slot order, no duplicate DOM IDs, and a bounded number of connection RPCs for 10 cards.
  - View profile opens `MemberDialog`, and Apply/Connect keep working.
- **Network assertions (via `page.on('request')`):**
  - The browser never talks to ACA or OpenAI.
  - No criteria appear in URLs.
  - AI responses are sent with `Cache-Control: no-store`.
  - Polling never has more than one request in flight and stops on hidden tabs.
  - Reopening a saved result makes no request that triggers a provider call.
- **Negative gating:** an admin-created job never unlocks recruiter mode (F18).
- **Audience cutover:** an unconfirmed member sees the confirm-status prompt, not an empty board (F29).
- **Deletion:** with AI rows present, self-delete and admin delete still work end to end (F30).
- **Evidence:** HTML report, plus traces on failure. Skipped or failed cases block the UI gate. Record the E2E job runtime at each gate (F24).
- **Visual pass:** a separate interactive browser pass (Playwright MCP), because the earlier review noted browser inspection was unavailable. It checks that every control has a visible shape (F23).

---

# Part B — current-app gaps (verified in source 2026-09-28) and fixes

Three read-only sweeps (UI states, security surface, readiness/tests) were run with graphify-first orientation. I re-read the key claims myself (✓ = confirmed by reading the file).

| # | Gap | Evidence | Fix | Verify |
|---|---|---|---|---|
| B1 ✓ | **Listing submit actions trust a client-supplied `mode`.** `submitEvent`, `submitOpportunity` and `submitVcGrant` accept `{mode}` from the browser. `guardSubmission` only applies Turnstile and the `submit` limit when `mode === "user"`, so `mode:"x"` skips both. The DB still re-checks approval. | `lib/actions/guardSubmission.ts:35-48`; `app/{events,opportunities,vcs}/actions.ts` | The public actions hard-code `mode:"user"`. Admin publishing goes through separate admin actions that call `requireAdmin`. `guardSubmission` rejects any unknown mode at runtime. | A Vitest case calls the action with `mode:"x"` and `mode:"admin"` as a non-admin; both are refused, and the test fails against the old code. |
| B2 ✓ | `/api/img` issues a signed avatar URL for any key, with no rate limit | `app/api/img/[purpose]/[key]/route.ts:41` | Validate the key shape (the gateway's blob-key format). Add a fail-open per-IP bucket. | Unit test: bad key → 404. |
| B3 ✓ | `/api/health` returns raw DB error text to anonymous callers | `app/api/health/route.ts:28,32` | Return `{ok:false}` only, and log details server-side | Unit test |
| B4 ✓ | **Failed loads look like "all clear".** `countOf`/`pendingEditCount` return 0 on any error, so the dashboard says "Queues clear". `rows()` turns a 4xx into `[]`, so admin queues say "Nothing pending". `listPendingListingEdits` returns `[]` on any error. `BlockedMembers` hides itself on error. | `lib/data/admin.ts:73-77,120-129`; `lib/data/query.ts:95-99`; `lib/listings/edits.ts:127-131`; `settings/BlockedMembers.tsx:48,54` | Add a small `rowsOrError`/`countOrError` pair next to `rows()`, and use it where an empty result would mislead: admin counts and queues, the edits queue, blocked members and the dialog links. Those surfaces show an error with Retry. The ~60 other `rows()` callers get an audit table in D3, not a blanket semantic change. | Vitest with a forced 4xx: an error state appears, not "clear". Playwright with a forced RPC failure on the admin dashboard. |
| B5 | **Busy state sticks forever** when an action rejects (no `try/finally`). BlockedMembers tracks only one busy id. | `ConfirmDialog.tsx:65-68`, `AcceptDialog.tsx:63-71`, `ReportDialog.tsx:41-44`, `ConnectControl.tsx:171-178,309-312`, `BlockedMembers.tsx:35,61-64`, `MarkActionPill.tsx:35-37`, `ConnectionsClient.tsx:245-248`, `SessionsSection.tsx:32-34` | Add `try/finally`, an error message and Retry. Use a Set of busy ids. | Vitest/RTL where the action rejects: the button re-enables and the error is shown. |
| B6 ✓ | **Controls with no pending state:** Sign out, Photo remove, CV Download/Remove, the GitHub nudge toggle, and a dismiss-prompt error that is silently ignored | `admin/SignOutButton.tsx:21-27`; `profile/ProfileForm.tsx:507-543,688-777,925-939,1081` | Use `Button loading`/`disabled`. Surface errors via the toast (C3). | Playwright double-click tests: one request each. |
| B7 | **Optimistic updates roll back silently.** Likes also hide the count behind a spinner. | `OpportunitiesClient.tsx:70-95`, `OpportunityActions.tsx:34-49`, `PostCard.tsx:61-73,154` | Toast on rollback. Block re-clicks while in flight. Likes show the optimistic count with no spinner. | Playwright with a routed failure: the count reverts and a toast is announced. |
| B8 | **Dialogs stall on failure** (see also B20). `CvProcessingDialog`/`GithubDialog` polls have no try/catch, so the skeleton spins forever. `GithubDialog` is blank before the showcase loads. `MemberDialog` fails silently. `ConnectControl` renders null and says "refresh" with no button. | `CvProcessingDialog.tsx:50-75`; `GithubDialog.tsx:53,59,89,205`; `MemberDialog.tsx:51-54,118`; `ConnectControl.tsx:195-204` | try/catch + Retry. A skeleton for each null state. Combine with **S3**: non-overlapping polls with backoff, jitter and pause-on-hidden. | Unit test: a slow poll never overlaps the next. Playwright: a forced failure shows Retry. |
| B9 | **Errors are caught only at a few levels.** `error.tsx` exists only at the root, `admin`, `calendar` and `community`. | route scan | Add segment `error.tsx` (a Retry that re-fetches) for members, opportunities, events, vcs, connections, profile, settings, my-*. Check how a rejected async transition behaves in React 19.2. | Playwright: a failing section keeps the shell and nav. |
| B10 ✓ | **The GitHub callback logs the full `/user` response body** | `auth/github-connect/callback/route.ts:117` | Log the status and named fields only | grep test |
| B11 | The OTP pre-check is advisory. A client can call Supabase `verifyOtp` directly. | `lib/auth/verifyOtpGate.ts:9-22` | Record that Supabase Auth's own limits are the real control. The owner confirms O3 (Auth rate limits) in the dashboard. | Owner screenshot in D2 evidence |
| B12 | `list_approved_*` are executable by `anon`. A body guard blocks non-members, but it is inconsistent with the lock-down pattern. | `20260917000018…:27,106` | Revoke from `public, anon` (keep the grant to `authenticated`), following the recreate-from-latest rule | rls_smoke `has_function_privilege` check |
| B13 | The worker DSN has no `sslmode` | `server/app/db.py:30` | Fold into F25: the `cv_worker` DSN uses `sslmode=require` | Worker boots against local Supabase |
| B14 | **CI gaps:** `adversarial_edges.sql`/`verify_prod_schema.sql` are never run. The SRH image is `:latest` and TruffleHog is `@main`. ZAP has `fail_action:false` and runs manually. No deployed-URL smoke; the prod-smoke schedule is commented out. The `db`/`e2e` jobs are skipped on PRs that don't match the path filter. | `.github/workflows/ci.yml`, `secret-scan.yml`, `zap-baseline.yml`, `prod-smoke.yml` | Add `adversarial_edges` to the rls job. Pin SRH and TruffleHog by digest or tag. Run the full suite on PRs to main. Re-enable scheduled prod-smoke after launch. | CI green, with the new job visibly running |
| B15 | **Vercel Preview shares production's Upstash database** (key prefix only) | `lib/ratelimit.ts:46-64` | A separate Upstash DB for Preview. Owner step: env vars. | Preview boot log |
| B16 | **No backups or restore test.** Free tier has no dashboard backups and no backup script exists. | `after-supabase-pro.md:112,140` | O1 (Pro) gives daily backups. Add `scripts/db-backup.sh` (session pooler `db dump`) for the tables in the checklist. Run one **restore rehearsal** into a local Supabase. | Restore log in D5 |
| B17 | **Stale docs:** `tasks/todo.md` C1–C3 and C4 still say Connections is unshipped, but it went live 2026-09-24 (#111) | `tasks/todo.md:56-60`; C4:3 | Tick them with a date and PR, and add a note to C4 | — |
| B18 | **Messaging is a "Coming soon" page** linked from nav | `app/messaging/page.tsx` | **Owner:** remove it from the Sidebar/nav and redirect `/messaging` to `/home` until messaging is built. Keep the file and record it in tasks/todo.md. | Playwright: no nav link; the route redirects |
| B19 | Worker running as a full-privilege login | F25 | Written into the AI plan's "Now, independent of AI" step in Part A, not in Part B. That step is **built at the start of phase 6, before A0** (owner, 2026-09-28), together with B13's `sslmode=require`. The owner then switches the VM env. | Worker tests pass against the scoped role locally; a missing grant fails the tests |
| B20 | **The ProfileForm ingest badge poll has no try/catch**, so the badge can stay stuck on "Processing" | `profile/ProfileForm.tsx:584-596` | Same fix as B8 (try/catch, backoff, Retry) | Unit test |
| B21 | **Upload-ticket JWT has no `aud`/`iss`.** HS256 is pinned, but nothing binds the ticket to its purpose. | `server/app/auth.py:96-101`; `lib/storage/uploadTicket.ts:63,83-93` | Next.js mints `aud="foundry-gateway-upload"` and `iss="foundry-web"`. The gateway requires both. Deploy order: the gateway accepts tickets both with and without them for one release, then requires them. | pytest: wrong or missing aud/iss → 401 |
| B22 | **The gateway delete body is bounded only by nginx** | `server/app/main.py:224,228` | Check Content-Length and cap it in the handler before `request.json()` (limit derived from 100 items) | pytest: oversize → 413 |
| B23 | **Mutating server actions rely only on the fail-open 60/min middleware backstop:** community (`actions.ts:184,202,220,246,294,308`), connections (`411,442,457,471`), `my-submissions/actions.ts:46`, `opportunities/actions.ts:38`, `profile/actions.ts:20`, `profile/mediaActions.ts` (13 exports), `updateOwnListing` | Security sweep §2 | Classify every exported action in a **server-action policy registry** (`lib/actions/registry.ts`) as read, write-cheap or write-costly. Writes get a dedicated `check()` bucket: fail-open for cheap toggles, fail-closed for costly or abusable ones. A Vitest test fails when an exported action is missing from the registry, mirroring `ratelimit.test.ts`. | Registry test; a limit test per new bucket |
| B24 | **Logs include blob keys plus raw error objects** | `lib/storage/blobRead.ts:273`; `lib/cv/extractText.ts:49`; `contact/actions.ts:60` | Log the error class/code and an opaque ID only. No raw error objects that may carry request data. | grep test |
| B25 | **ConnectControl makes 4 RPCs per mount and uses fixed DOM IDs** (`connect-status`, `connect-note`, `connect-note-count`) | `components/connections/ConnectControl.tsx` | One `connection_panel_state(target)` RPC returns status, quota and cooldown together (recreated per the latest-signature rule, with revoke/grant). `useId()` gives unique IDs. Show a skeleton while loading. | rls_smoke grant check; Playwright: one RPC per dialog open, no duplicate IDs |
| B26 | **Every authenticated page makes ≥3 sequential Auth/DB round trips.** Proxy `getUser` (`lib/supabase/proxy.ts:52`), then guard `getUser` (`lib/auth/guard.ts:92`), then `is_admin` + profile. | F8, C6 | D1 measures first. Then: the guard switches to `getClaims()` (local JWT check; needs asymmetric JWT signing keys, **owner: confirm or enable in Supabase**), with the DB status check kept. `is_admin` and profile go into one RPC wrapped in React `cache()` per request. Test fra1 vs lhr1 against the London DB in the E3 window. | Before/after p95 per stage recorded in D1; guard tests (19) still green |
| B27 | **Static routes (`/`, `/privacy`, `/terms`, `/cookies`) use a CSP with `'unsafe-inline'` scripts** | `next.config.ts:69-71`; `lib/csp.ts:175-180` | D2 confirms these pages render no user-controlled content. If so, keep them static and document the accepted risk. If any does, move it to the nonce CSP (dynamic). Try Next's SRI/hash option first. | CSP spec in `public.spec.ts` updated |
| B29 | **Repo hygiene.** `after-supabase-pro.md`, `cv-matchmaker-spec.md` and `scalability-audit.md` are modified. The AI docs and `docs/ai-migration-inventory.md` are untracked. Memory records an unexplained earlier loss of merged PR #61 from main. | git status at session start; memory | Commit the docs with Part A. Before E2, re-derive the branch audit: `git log main..feat/connections`, merged PR list vs main contents (squash-aware). Don't trust old notes. | A list of PRs expected on main, each checked |
| B30 | **The AI source docs haven't been audited line by line.** `AI-data-audit.md` and `docs/ai-migration-inventory.md` are treated as authoritative. | Part A "Not audited" note | First step of A0: verify every citation in both docs against current migrations and code, and correct them in place | A findings list is appended to AI-plan-review |
| B28 | **Accepted, with a documented reason:** `clearRecoveryMarker` has no auth (it only clears a cookie). The `mutations` backstop fails open by design (the prod boot alarm fires if Upstash is missing). The unauthenticated `/api/img` is needed for `/committee` avatars. | Security sweep §§1–2 | Record in D2 as accepted | — |

---

# Part C — loading, pending and perceived-speed pass

**Principles:** reuse `components/ui/Skeleton.tsx` and `Button loading`, and add no new libraries.
- **Route-level loading:** a skeleton that matches the real layout, so nothing jumps when the data arrives.
- **In-button actions:** a spinner inside the button.
- **Navigation:** a progress indicator.
- **Instant toggles:** an optimistic update, with rollback and a toast on failure.
- **Brief waits:** no spinner flash under ~300 ms.
- **Accessibility:** `aria-busy` on regions that are loading. Reduced motion follows the existing global rule.

1. **C1 route skeletons:** add `loading.tsx` for:
   - `admin/`, as a segment skeleton behind the blocking layout, plus page-shaped skeletons for the admin dashboard, connections, reports, edits, events, opportunities, vcs, and the new-listing forms;
   - `committee`, `contact`, `onboarding` and `settings`;
   - `login`, where `fallback={null}` currently renders a blank page and should become a form skeleton.

   Static legal pages need none.
2. **C2 navigation progress:** a thin top progress bar driven by Next 16's `useLinkStatus` on Sidebar/nav links, plus `aria-busy` and a small inline spinner on the dimmed filter lists (Members, VCs, Connections, admin lists). The admin status tabs dim the stale list and mark the clicked tab immediately.
3. **C3 toast system:** one small accessible (`role=status`/`alert`, aria-live) provider in AppShell. It handles B5–B8 errors and success confirmations where the UI currently goes silent. Copy is one sentence plus a link, per the owner's preference.
4. **C4 empty states:** NewestMembers on home. Facet filters show "couldn't load filters" instead of disappearing.
5. **C5 AI surfaces:** the AI plan's progress stages, and "previous results" kept while a turn runs, use the same components.

**Verify:** each Part B/C item has a Playwright or Vitest case. Run with a throttled-network Playwright project (slow 3G profile): every route shows a skeleton or spinner within 300 ms, and no layout shift above CLS 0.1 when data arrives. Then a manual Playwright MCP visual pass.

---

# Part D — full audit programme

Each audit produces `docs/audits/D<n>-<name>.md`: scope, method, raw evidence, findings (severity), fixes made, and anything left open. Every finding is either fixed with a failing-first test, or explicitly accepted by the owner. **No review subagents write findings.** They fabricated a codebase here before, so audits run inline, and subagents are used only to locate code.

| Audit | Scope and method | Exit gate |
|---|---|---|
| **D1 Scalability/performance** | EXPLAIN (auto_explain, parameterised) for every list/detail RPC at a 2k/10k corpus, following the C2/C5 harnesses. Check N+1 and fan-out reads (e.g. ConnectControl's 4 RPCs per mount). Look at cache hit/miss/stampede behaviour, polling load, Auth round trips (F8: `getClaims`, lhr1 vs fra1 test), bundle size per route, image sizes, and Core Web Vitals via Lighthouse CI on key routes. | No query over 100 ms p95 at 10k. LCP < 2.5 s and INP < 200 ms on mid-tier mobile. Documented Auth-hop fix decision. |
| **D2 Security** | Build an authz matrix: every route handler, server action and RPC × role (anon/pending/rejected/member/admin), with negative tests. Live `aclexplode` grant dump vs the allowlist. RLS review of every table. B1–B16 fixes. Secrets and env review. CSP/headers, including the weaker CSP on static routes. Upload paths (gateway magic bytes, zip ratio, pikepdf). SSRF/redirects (`auth/callback` next). Dependency audit (`pnpm audit`, `pip-audit`, Trivy) and Dependabot state. Then a ZAP **active** scan against the Part E pre-launch prod window with synthetic users, and optionally an external pentest before public launch. | Zero open High/Critical. Every server action checks auth and has a rate-limit decision in the registry. The grant dump matches the allowlist. Because every committee member will be an admin, every admin RPC, including the destructive ones (bulk graduate delete, bans, user delete), must write to `admin_actions`. A test enumerates the admin RPCs and fails on any that don't. |
| **D3 Reliability/data correctness** | Outage drills (Supabase stopped, Upstash down, gateway down, worker down, OpenAI 429/5xx) per the S2 method. The `rows()` caller audit (B4). Idempotency/double-submit on every mutation. Cron routes (drain-email, drain-blob-deletions, github-showcase-nudge, digest) under failure and re-run. Account-deletion FK paths (F30). | Every drill ends in a visible error with Retry, no silent empties, no duplicates. |
| **D4 UI/UX + accessibility** | Heuristic walkthrough of every route in the Part E matrix, desktop + mobile. axe (`@axe-core/playwright`, new dev dependency) on every page and state. Keyboard-only and screen-reader smoke (VoiceOver). 200% zoom. 44 px targets. Buttons with visible shape (known recurring issue). Copy check against "one sentence + link". Consistent empty/error/loading states (Part C). | Zero axe serious/critical issues. Every flow completable by keyboard. The owner reviews screenshots. |
| **D5 Ops/DR/observability** | Sentry on every surface (client/server/edge/gateway/worker), with alert rules emailing the owner (Part G). PostHog privacy (F19). Uptime monitor (extra). Backup + restore rehearsal (B16). Key rotation runbook dry run. Incident plan tabletop. Deploy rollback per component (Vercel instant rollback, gateway/worker previous GHCR digest, additive migrations). The container-digest check (stale `:latest` lesson). | Restore rehearsed, and rollback rehearsed once per component. |
| **D6 Privacy/compliance** | Privacy page, ROPA, DPA register and DPIA vs actual processing (F15, PostHog, OpenAI, Azure, Resend, Upstash). Retention jobs vs documented retention. New features (data export, notifications, AI) added before they ship. DSAR round trip using the new export. | Controller sign-off recorded. No known false statement in public copy. |
| **D7 Supply chain/CI** | Pinned actions/images (B14). Lockfile integrity. `pnpm-workspace.yaml` overrides. Required checks on main (owner confirms in GitHub settings). CodeQL alerts triaged. | No unpinned third-party action. Required checks documented. |
| **D8 Cost** | Monthly run-rate: Vercel, Supabase Pro + compute, Upstash, Azure VMs + ACA, Resend, OpenAI caps, monitoring. Alerts at 80%. | Owner-approved budget table. |

---

# Part E — production rollout and final verification

**E1 Environments.**
- There is no staging environment. The owner chose prod-before-launch for load testing.
- Prod is admin-only and unlaunched, so it doubles as the final test environment until launch day.
- Local ephemeral Supabase stays the place for all correctness and E2E work.
- Never source `.env.local`, which is PROD.

**E1a Supabase Pro compute sizing (Pro is now active, per the owner on 2026-09-28).**

Evidence (`scalability-audit.md` §3, `after-supabase-pro.md:119-135`):
- A ≈Free database held 50 members active at once and failed at 100.
- Two *full* cores held 250 (p95 < 0.43 s). At 500 it had 0 errors but p95 of 9–16 s.
- Micro, Small and Medium all have **2 shared, burstable cores**. Medium adds RAM (4 GB) and connections (120 direct / 600 pooled), not CPU.
- **Large** is the first tier with dedicated CPU.
- Postgres, PostgREST and Auth share the project's compute. That is why Auth round trips (B26) and page reads (88% of DB time) count against the same budget.

Steps. The owner does the dashboard parts, out of hours, since each change restarts the DB for 1–2 minutes.
1. **Set compute to Medium now.** Confirm under Settings → Compute and Disk: upgrading the plan does not upgrade compute by itself. Record the before/after in `after-supabase-pro.md`.
2. **Finish the rest of the Pro checklist in `after-supabase-pro.md`** (several items were missing from this plan):
   - spend cap ON;
   - daily backups visible, plus **a restore into a throwaway project** (replaces the local-only rehearsal in B16);
   - **leaked-password protection ON** (tested with a known-breached password);
   - Auth per-IP sign-in/verify limits raised to **500 per 5 min**. This supersedes the 150 in `after-supabase-pro.md`; see E1d;
   - CAPTCHA toggle ON;
   - re-run `supabase/checks/launch_capacity.sql`, `verify_prod_schema.sql` and, the next day, `cron.job_run_details`.
3. **Before the load window, cut DB work per page:**
   - B26: one Auth-plus-profile round trip, not three;
   - B25: ConnectControl down to one RPC;
   - D1: `pg_stat_statements` top 10 at a 2k/10k corpus.

   Every millisecond of DB CPU saved raises the user ceiling on every tier.
4. **Medium is the owner's chosen launch tier.** The E3 window verifies it. A step up happens only if Medium measurably fails the 500 gate after the step-3 optimisations, **and the owner approves the cost**. The fallback ladder, re-running the same k6 profile at each step:
   - **Medium:** 250 VUs held 30 min, then the 500 ramp.
   - **If 500 fails:** step up to **Large** (dedicated 2-core, 8 GB) and re-run.
   - **If it still fails:** **XL** (dedicated 4-core, 16 GB), or more query and caching work if `pg_stat_statements` shows a clear hotspot.
   - **Watch each run:** DB CPU (sustained > 70% = fail), memory/cache hit rate, disk IO budget, pooler waits, PostgREST 5xx, Auth latency. Vercel function time, Upstash and the gateway are watched separately so the bottleneck is attributed correctly.
5. **Confirm the launch size:** Medium if it passes the 500 gate. Otherwise the owner-approved step up, with a documented step-down rule (e.g. drop one size after 2 weeks under 30% CPU at peak).

   Approximate monthly compute cost:

   | Tier | Approx. cost/month |
   |---|---|
   | Medium | ≈ $60 |
   | Large | ≈ $110 |
   | XL | ≈ $210 |

   Pro's $10 credit comes off these. Confirm on Supabase's pricing page before switching; D8 records the actual cost.
6. **Post-launch triggers** (from `scalability-audit.md` §3): step up one size if CPU stays > 70% for 10+ minutes, p95 page time > 1 s, or PostgREST 5xx appears.

**E1b Capacity targets: 250 first, then 500 (owner, 2026-09-28).** The goal is 500 members active at once without failures, reached in two gated stages. "Without failure" is defined measurably:
- zero semantic failures (wrong or error pages);
- 5xx rate < 0.1%;
- no 429s except where a test deliberately exceeds a documented limit;
- exactly-once writes;
- no queue growth.

| Stage | Load | Latency gate | Also required |
|---|---|---|---|
| **Stage 1 — 250** | 250 distinct users held 30 min, plus spike 0→250 in 10 s | Page p95 < 1 s, p99 < 3 s | DB CPU < 70% sustained |
| **Stage 2 — 500** (started only after Stage 1 passes) | 500 distinct users held 30 min, spike 0→500, 2 h soak at 250, stress to failure beyond 500 | Page p95 < 2 s, p99 < 5 s | Recovery < 2 min |

- **Stage 1 loop:**
  1. Measure locally at a 2k/10k corpus, with the DB container limited to Medium's size (using the local M-metrics below).
  2. Fix the top offenders (B25, B26, D1 query fixes and caching).
  3. Re-measure until the local run passes with headroom.
  4. Confirm with **one** pre-launch prod run in the E3 window on Medium (owner-confirmed 2026-09-28). It is measured only by k6's own numbers plus the Supabase dashboard graphs; no metrics code runs in prod.
- **Stage 2:** the same loop. If Medium can't pass after optimisation, E1a step 4 applies (owner-approved step up).

I can't truthfully promise "never fails under any conditions": a Supabase or Vercel outage is outside the app. The promise is that these gates pass on the launch configuration, with evidence, and that after launch the existing error monitoring (Sentry errors only) and the uptime monitor (D5) catch outages. Read/write timing stays a local tool.

**E1d Launch-day burst: the limits that sit outside our code (added 2026-09-28, final gap check).**

Our own app buckets are already safe for campus NAT. I checked:
- `mutations` is keyed per user (`u:<id>`);
- `anonMutations` is 1200/min per IP;
- `otpVerify` is keyed per email (`proxy.ts:65-66`, `verifyOtpGate.ts:19`).

Three limits outside the code would break a launch where 500 students sign up in the same hour:

1. **Supabase Auth "emails sent per hour" is project-wide, and set to 300.** `after-supabase-pro.md` calls that "fine", but it isn't at launch. Everyone is new on launch day, so everyone needs a sign-in code. 500 sign-ups in the first hour means about 200 people get no code.
   - **Owner:** after Resend Pro, raise it to ≥1000/h.
   - **Owner:** confirm that Resend's send rate covers about 2 codes/s at peak, and ask Resend for more headroom if it doesn't.
2. **Supabase Auth per-IP sign-in/verify limits, planned at 150 per 5 min.** Sign-in runs in the browser, so every phone on campus Wi-Fi shares one IP.
   - Recommend **500 per 5 min** for sign-ins and token verifications. CAPTCHA (E6a) is the abuse control that makes a higher limit safe.
   - The E5 auth-burst run deliberately sends everything from **one** IP to simulate campus NAT, and shows whether the limit holds.
3. **Vercel plan.** `after-supabase-pro.md` §3 lists Vercel Pro as "planned", so prod is probably still on Hobby. Hobby bans commercial use, has monthly function quotas, and **pauses the project when a quota is exceeded**. The E3 k6 programme (30-min holds, a 2 h soak, stress to failure) could use up those quotas and take the site down.
   - **Owner:** confirm the plan. If it's Hobby, upgrade to Pro before E3.
   - D8 estimates what the E3 window will cost (Vercel function time, Upstash commands, Supabase egress), and the owner approves that estimate before the window opens.

`after-supabase-pro.md` is corrected to match all of the above. Its old 500-user pass criterion ("p95 under 5 s") is replaced by a pointer to the E1b gates, so the two documents never disagree.

**E1c Read/write observation metrics: LOCAL ONLY (owner, 2026-09-28).**

These are built in Part B, before any load test, and used only during local load testing and optimisation. **Nothing new ships to prod**:
- the instrumentation is off unless `PERF_METRICS=1` is set, and it's only set by the local load scripts;
- prod Sentry keeps `tracesSampleRate: 0` (errors only, as today);
- no `Server-Timing` header in prod;
- no Web Vitals events to PostHog.

A Vitest test asserts that the flag defaults off and that a production build without it emits no metrics or headers. The labels follow the same no-PII rule: route templates, action names and RPC names only.

- **M1 Server read timing.**
  - Wrap `rows()`/`maybeRow()` in `lib/data/query.ts`, plus the guard's Auth/profile calls, with a timing helper.
  - The helper records duration, outcome (ok/empty/error/unreachable) and row count per `source` name.
  - With the flag on, page renders also emit a `Server-Timing` header (auth;db;render), so k6 sees the stage breakdown.
- **M2 Server write timing.** The B23 server-action registry wrapper records duration, outcome (ok/validation/limited/unavailable/error) and rate-limit decision per action name. It also covers route handlers and crons, and gateway/worker jobs through the existing local gateway/worker load harness.
- **M3 Local sink.**
  - M1/M2 append JSON lines to `frontend/.perf/metrics.jsonl` (gitignored).
  - No external service is involved, and Sentry and PostHog are untouched.
- **M4 Local database.**
  - `supabase/checks/pg_stat_snapshot.sql` captures the `pg_stat_statements` top 20 by total and mean time, plus calls, rows and cache hits.
  - `supabase/checks/db_health.sql` captures connections, locks and cache hit ratio.
  - Both run against the local Supabase before and after every run, with a stats reset between runs.
  - `docker stats` sampling records DB and PostgREST container CPU/memory.
  - As in `scalability-audit.md` §3, the DB container is CPU/memory-limited to emulate **Medium** (2 cores, 4 GB), so local numbers are about the launch tier and not the laptop.
- **M5 Measurement for my own use, with no visualisation (owner, 2026-09-28).**
  - No dashboards, charts or report documents.
  - k6 tags every request as read or write, by route template.
  - A small CLI (`scripts/perf-summary.mjs`) reads the k6 JSON, `metrics.jsonl` and the M4 snapshots, and prints plain text to the terminal:
    - the **read/write ratio** by count and by DB time;
    - p50/p95/p99 per read source and per write action;
    - the slowest queries;
    - container CPU.
  - I use that output to decide what to optimise:
    - **read-heavy hotspots:** query/index fixes, caching, fewer round trips;
    - **write-heavy hotspots:** batching, lock and contention fixes, trigger costs.
  - I re-run the same profile to confirm each gain.
  - Only the gate outcomes (pass/fail with key numbers) are noted in `tasks/todo.md`.
- **Verify:**
  - A Vitest test that the timing wrapper never leaks IDs into labels.
  - A Vitest test that with `PERF_METRICS` unset, nothing is written and no `Server-Timing` header is set.
  - A local k6 run followed by `perf-summary` prints the read/write ratio and per-source/per-action latencies.

**E2 Release train** (the batched push rule: one PR to main when the branch is done):

1. PR → full CI (every job forced, not path-filtered) → owner merge.
2. **Migrations first**, owner-run `supabase db push`. They must be additive and backward-compatible with the old frontend. Then run `verify_prod_schema.sql` and the live grant dump.
3. `app_config` rows and seeds (any new cron URLs), with feature flags **off**.
4. Frontend deploy via Vercel on merge.
5. Gateway and worker deploys via GHCR. Verify the **running container digest**, not just CI or systemd status.
   **Order matters for B21:** the gateway that accepts `aud`/`iss` must be live *before* the frontend that mints them, because an older gateway rejects any ticket carrying `aud`. So deploy the gateway first (step 5 before step 4 for this release), then the frontend, then, a release later, set `UPLOAD_TICKET_REQUIRE_AUDIENCE=true` on the gateway VM (owner).
6. ACA executor (AI) with flags off.
7. Smoke: `prod-smoke.mjs` plus a manual admin walkthrough.
8. Turn on flags, one feature at a time, each followed by smoke.

For each step, the rollback is: Vercel instant rollback, the previous GHCR digest, flag off; migrations are never rolled back destructively.

**E3 Pre-launch prod test window.** Safeguards for testing on prod:
- **Upgrade first.** Finish E1a steps 1–3 before testing. The window then runs the E1a step-4 compute ladder, so the launch tier is the one that passed.
- `after-supabase-pro.md` says "never point the 500-user test at the live site". Pre-launch, prod isn't live, which is why the owner chose this window. After launch, that rule applies again.
- **Synthetic users.** Create them through the Auth Admin API (never raw SQL inserts: NULL token columns break `listUsers`), on a reserved domain (`@loadtest.foundry.invalid`), and record them in a manifest. Directory data is seeded by a script that tags every row. The email drain skips any recipient on the `.invalid` TLD for good. RFC 2606 reserves `.invalid` as never deliverable, so this is a correctness fix and not a test bypass, and those rows are marked skipped rather than sent.
- **Cleanup.** A dry-run cleanup script lists exactly what it will delete, then deletes it with the owner watching. Afterwards, verify zero tagged rows and zero synthetic auth users, and restore from backup if anything is off. Take a fresh `db dump` before the window opens.
- **No bounces from synthetic mail.** Mail sent to `.invalid` addresses bounces, and bounces damage the `mail.` sending domain's reputation, which puts real sign-in codes at risk.
  - Any flow in the window that sends mail (the auth burst, connection requests, digests) uses Resend's test addresses, `delivered+<n>@resend.dev`.
  - Synthetic users created through the Admin API are marked email-confirmed, so creating them sends nothing.
  - The student Imperial-domain check is never loosened for the test. Student-only flows use Admin-API users.
- **Edge and rate limits.**
  - The load generator runs from a cloud VM in the UK: the existing worker VM is not used, so use a temporary B-series VM or k6 Cloud.
  - Its IP is temporarily allowlisted at Cloudflare/Vercel firewall so edge 429s don't mask origin capacity.
  - App rate limits stay **on**: distinct users naturally spread across per-user buckets, and hitting a limit is a finding, not a bypass.
  - No bypass header is ever added to the code.
- **AI.** Prod AI load runs with real providers only as a small capped smoke. Queue/admission capacity at 500 is tested with the fake provider on local/ephemeral infra, because a fake-provider path must never exist in prod.
- **After launch** this window is gone. Any future capacity retest needs a staging project (flagged for D8 cost).

**E4 Full Playwright pass** (extends AI-plan §14.4 to the whole app):
- **Route matrix.** Every `page.tsx` × every role, with a unit test that fails when a new page has no matrix entry.
- **Projects.** Add a mobile project and a throttled-network project. For the final pass, also add **WebKit (desktop + iPhone) and Firefox**. Every CI run stays Chrome-only for speed. Safari matters because many students are on iPhones.
- **Gap routes.** Cover every currently uncovered route (F13 list plus `/pending`, `/rejected`, `/onboarding`, `/cookies`).
- **Uploads and processing.** Real uploads via `setInputFiles` against a local gateway. Drive CV/GitHub processing dialogs with the fake provider.
- **Crons and health.** Call the cron routes with `CRON_SECRET`, and hit `/api/health`.
- **Auth and outages.** Turnstile uses test keys. GitHub OAuth goes through a local mock of GitHub's endpoints; Google OAuth is only a redirect smoke. Include outage drills from D3.
- **Deliberate failures.** Every Part B/C state is covered, including forced RPC failures via `page.route`.
- **Accessibility.** axe on every page and state.
- **New features.** Every new feature (notifications, export, toast, AI) is covered.
- **Two runs.** Run local first (rebuilt build, ephemeral Supabase). Then run a read-only plus synthetic-user subset against prod in the E3 window.
- **Visual.** Finish with a Playwright MCP visual pass.

**E5 Full k6 programme** (extends `frontend/scripts/loadtest.js`; the mint script gets a prod-window mode guarded by the manifest):

| Run | Profile | Pass gate |
|---|---|---|
| Baseline | 50 VU, 10 min | Establishes p50/p95/p99 per route |
| Load, Stage 1 | 100→250 distinct identities, 30 min hold at 250, realistic read/write mix | E1b Stage 1 gate |
| Load, Stage 2 (only after Stage 1 passes) | 250→500 distinct identities, 30 min hold at 500 | E1b Stage 2 gate |
| Stress/breakpoint | Ramp to 750 → 1000 → failure | Record the knee and failure mode. Recovery < 2 min after load drops |
| Spike | 0 → 500 in 10 s | No 5xx cascade; the queue drains |
| Soak | 250 VU for 2 h | No memory/connection creep; p95 stable ±10% |
| Writes | Bookmarks, mark-applied, connection send/accept, community posts/likes/reports, listing submissions, profile edits, including duplicate/retry races | Exactly-once effects. Rate limits trip as designed. |
| Polling + uploads | CV/GitHub dialogs polling; gateway uploads at measured rates | No overlap storm. Gateway CPU < 80%. |
| Auth burst | Launch-shaped OTP sign-in burst: 500 codes over 10 min to `delivered+<n>@resend.dev`, all from **one** IP to mimic campus NAT (E1d) | Every code is delivered. No 429 below the configured limits. Unrelated users are never locked out. |
| AI | Local 500-submission admission burst with the fake provider; prod capped smoke | Per AI-plan §14 gates |

Each run records Supabase CPU/memory/connections, Vercel function metrics, Upstash commands, gateway/worker CPU and Sentry errors. Gate outcomes are noted in `tasks/todo.md`, with no report documents. A failed gate means fix, re-run and re-check.

**E6a Owner configuration carry-overs.** These are known outstanding dashboard steps. Each needs a screenshot or check as evidence.
- **Supabase Auth:**
  - Flip the captcha toggle (Turnstile on login is inert until then).
  - Set the OTP length to 6 and paste the light email templates.
  - Do the alum OTP round-trip test.
- **Supabase Pro + compute:** Pro is done. Compute sizing and the rest of the Pro checklist are in E1a. Confirm asymmetric JWT signing keys if B26 goes ahead.
- **Resend Pro (O2):** then raise `digest_daily_cap` to 800. Also raise the Supabase Auth emails/hour to ≥1000 and confirm Resend's send rate (E1d).
- **Supabase Auth per-IP sign-in/verify limits (O3):** raise to 500 per 5 min, with CAPTCHA on first (E1d).
- **Vercel:** confirm the plan, and upgrade to Pro before E3 if prod is on Hobby. Approve the estimated cost of the E3 window (E1d).
- **`app_config`:** add the missing GitHub showcase nudge URL (the digest URL is already seeded).
- **Connections handshake steps** still pending since the 2026-09-24 ship.
- **Vercel env vars:**
  - Sentry source-map variables.
  - A separate Upstash for Preview (B15).
  - `CRON_SECRET` in both places.
- **SEO:** Google Search Console, Cloudflare robots rule, favicon.
- **Google OAuth:** consent-screen branding and verification after the legal pages are final.
- **L1 domain-change checklist** (OAuth, email domain, Site URL/redirects, Turnstile hostnames, CSP, cookies, canonical).
- **AI prerequisites.** These are needed before A1's live-provider smoke and before AI deploys. Until then I build and test everything against the fake provider locally.
  - A dedicated OpenAI project and API key for matching, separate from ingestion, with project spend alerts and the org hard limit checked.
  - DPA/data-controls settings recorded (AI-plan §13).
  - Azure: resource group, Container Apps environment in UK South, Key Vault, and a registry pull identity (AI-plan §10.1).
  - An approved cost ceiling for live evals (AI-evaluation-plan).
  - Legal/DPIA sign-off before any mode's flag goes on.
- **Required checks on main** in GitHub settings (D7).
- **Committee as admins.** Every committee member is fully onboarded, then made an admin through the SQL add-admin procedure (onboard first, then insert into `admins`). This happens after the E3 cleanup and before E5b.
- **Launch content.** Seed real events and opportunities so the first visitors don't find an empty site.
- **Sentry:** confirm the source-map env vars, the owner's alert email, spike protection and the plan quotas (G5/G6). **PostHog:** confirm the plan quota.

**E5b Committee acceptance test** (owner, 2026-09-28). Once the E3 cleanup is verified, the committee, all onboarded as admins, uses the finished app on prod before any public sign-ups.
- **The script.** One written checklist in `docs/`, covering:
  - student and alum sign-in;
  - onboarding and the profile;
  - CV and GitHub;
  - listings: submit, edit, withdraw;
  - bookmarks and applying;
  - Connections;
  - community;
  - notifications and data export;
  - the three AI modes;
  - the admin queues, reports and banner.

  Each person also does it on their own phone.
- **Feedback** goes into `tasks/todo.md`. A blocker goes back through the fix → local re-test → release loop.
- **Cleanup.** Anything created only for testing is deleted before launch. The committee's own profiles stay, since they're real members.

**E6 Launch.** The go/no-go checklist:
- all D gates are green;
- E4 and E5 pass;
- the E3 cleanup is verified;
- E5b has no open blockers;
- every E6a item has evidence;
- alerts reach the owner.

The watch window is 72 h of enhanced monitoring, with an agreed rollback trigger. The incident banner (F-x4) is how members hear about any problem.

---

# Part F — extras (owner-selected) and nice-to-haves

- **F-x1 Uptime monitor + alerts:** **Sentry Uptime Monitoring**, so there is no new vendor (owner: avoid extra SaaS). It watches `/api/health`, which already hits the DB, and gateway `/health`. If the Sentry plan allows only one uptime monitor, use it on `/api/health`, and cover the gateway and worker with G3 cron check-ins. Alerts go by email to the owner. The gateway health check stays liveness-only. Add a DB-touching readiness check only if it proves useful.
- **F-x2 Self-serve data export:**
  - Settings → "Download my data".
  - A server action (auth + rate limit, fail-closed) builds a JSON bundle from owner-scoped RPCs: profile, skills, listings, bookmarks, activity, connections (own side only), posts, CV metadata and extracted profile, GitHub selections, consent records and, later, AI history.
  - Streamed download, no-store.
  - Other members' private data is excluded.
  - It is listed on the privacy page as the DSAR route. D6 tests the round trip.
- **F-x3 In-app notifications:**
  - Scope:
    - A `notifications` table (owner-scoped RLS, FK cascade on account delete per F30, 90-day retention via pg_cron per F31).
    - It is written by the same DB events that already feed the outbox: connection requests/accepts, listing approved/rejected/edit decisions, and report outcomes.
    - A bell with an unread count in AppShell, a list page, and mark-read.
  - Behaviour:
    - It follows the non-overlapping polling policy. No Realtime subscription is used, because none exists today.
    - Email stays the off-site channel.
    - Controls are named and use `--color-border-strong`.
  - Checks: D2/D4/E4/E5 coverage, and privacy docs updated.
- **F-x4 Incident banner, managed from the admin panel** (owner, 2026-09-28).
  - **Data.**
    - A dedicated single-row `site_banner` table: message, severity (info / warning / critical), optional link, optional expiry, enabled flag, `updated_by`, `updated_at`.
    - It is kept out of `app_config`, which holds `cron_secret`, so admins never get write access to a table that holds secrets.
  - **RPCs.** Both follow the recreate-from-latest and revoke rules.
    - `admin_set_site_banner(...)`: SECURITY DEFINER, checks `is_admin()`, validates input. Revoke from `public`, `anon`, `authenticated`, then grant to `authenticated` with the admin check in the body.
    - `get_site_banner()`: readable by everyone, including logged-out visitors. It returns nothing when the banner is disabled or expired.
  - **Admin UI: `/admin/banner`.** A card on the admin dashboard links to it.
    - Message textarea, capped at 200 characters with a live count.
    - Severity select.
    - Optional link: `https://` only, validated both client- and server-side.
    - Optional "hide after" date and time.
    - Live preview; Publish and Clear buttons with `Button loading` states and toast confirmation.
    - Shows who last changed the banner and when. Every publish and clear is also written to the existing `admin_actions` log.
    - Any admin (every committee member at launch) can set it.
  - **Where it shows.** AppShell (every signed-in page), the login page, and `/pending` and `/rejected`. The login page matters most: if sign-in is broken, that's where people look.
    - The static landing and legal pages stay static and don't show it, because that would make them dynamic and change their CSP (B27).
    - Read through the existing `cached()` with a short TTL, and `invalidate()` on publish or clear, so it appears within seconds.
  - **Behaviour.**
    - Rendered as plain text (no HTML) with `role="status"`; critical uses `role="alert"`.
    - Info and warning banners can be dismissed per banner version (localStorage, wrapped in try/catch). Critical banners can't be dismissed.
    - Publish and clear are tracked as PostHog enum events (G7).
  - **Verify.**
    - `rls_smoke`: a non-admin and anon are refused on the set RPC (`has_function_privilege` plus the body check).
    - Vitest: link and length validation.
    - Playwright: an admin publishes, and the banner appears on `/home` and `/login`; clearing hides it; an expired banner hides itself; an XSS string renders inert; dismissing holds until the message changes; the admin page gets its B23 registry row, rate-limit bucket and axe pass.
- **Nice-to-haves not selected, for later:** filter-based job alert emails, a notifications preference centre, an admin audit-log viewer, and messaging (restore the nav link when built).

# Part G — Observability refresh: Sentry, PostHog, cron/queue health, AI tracing (added 2026-09-28)

**Why:** the last Sentry and PostHog pass was on 2026-09-04. Since then a lot has been added, and much of that surface is unmonitored:
- Connections: actions, ConnectControl and the digest cron;
- listing edits, the GitHub showcase nudge, the gateway and the worker;
- everything this programme adds: toasts, notifications, data export and the AI executor.

Twice already a feature has failed **silently for weeks**:
- the digest URL was never seeded;
- `github_showcase_nudge_url` was missing in prod, so the Monday cron did nothing.

Error tracking alone can't catch that class of failure, because nothing ever errors.

**The prod rule is unchanged:** errors and health only. `tracesSampleRate` stays 0, there is no prod perf/Web Vitals telemetry, and read/write metrics stay local (E1c).

1. **G1 Surface inventory.** A table in `docs/observability.md` with one row per surface: every route handler, server action (reusing the B23 registry), cron, gateway endpoint, worker job type and AI stage. Each row records:
   - its Sentry capture point, with a `surface` tag;
   - its PostHog event, if any;
   - its alert.

   A Vitest check fails when a registry action has no row, mirroring B23.
2. **G2 Sentry on the Python side.**
   - Install `sentry-sdk` in the gateway, the worker and (later) the ACA executor. First verify what is already there.
   - Set `send_default_pii=False` and add a `before_send` scrubber that drops request bodies, blob keys and CV text.
   - Tag every event with its release (the GHCR digest) and environment.
3. **G3 Sentry cron monitors (heartbeats).** Every cron route (drain-email, drain-blob-deletions, connections-digest, github-showcase-nudge, plus notifications retention and AI purge when built) checks in at start and finish. The worker loop checks in every N minutes. A **missed or late check-in alerts**. This is the fix for the silent failures above.
4. **G4 Queue and backlog health.** One DB-only check (`app_health_snapshot()`) run by pg_cron through the existing cron pattern. When a threshold is crossed it sends a Sentry message: an error, not a perf metric. It watches:
   - email outbox depth and age of the oldest item;
   - CV/GitHub `jobs` stuck in processing past their lease;
   - the blob-deletion backlog;
   - the admin moderation queue age;
   - the AI turn queue age and ledger headroom, once built.
5. **G5 Alerts and routing.** Sentry rules for:
   - a new issue, a regression, or an error spike on any surface;
   - a missed cron check-in;
   - G4 threshold messages;
   - uptime failures (F-x1).

   Alerts go **by email to the owner only**; there is no backup person (owner, 2026-09-28). Turn on Sentry spike protection so a load test or an incident can't use up the monthly quota and leave us blind. D8 checks the Sentry and PostHog plan quotas.
6. **G6 Releases and source maps.**
   - Confirm the `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` Vercel env vars are set. They were never confirmed after 2026-09-04, so prod stack traces may still be minified. Check by throwing a test error in prod and reading a de-minified trace.
   - Tag every event with its environment: production, preview or local.
7. **G7 PostHog event taxonomy and launch dashboards.**
   - Keep a taxonomy table in `docs/observability.md`: event name, properties, and allowed values. Enums only, never PII, IDs of other members, criteria or scores (F19).
   - Add funnels for the surfaces built since 09-04:
     - Connections: send, accept, decline, remove;
     - listing edits;
     - notifications (open, mark-read);
     - export requested;
     - admin moderation decisions (scoped out on 09-04, and useful at launch);
     - AI (mode started, refused-by-reason, result opened, budget exhausted), enum-only.
   - Build launch dashboards **in PostHog**, for the owner, not local visualisation:
     - signup → OTP → onboarding → profile-complete funnel;
     - weekly active members;
     - Connections activity;
     - AI usage by mode.
   - Apply the `before_send` URL sanitiser from F19.
8. **G8 Keep test traffic out of analytics.** Synthetic E3 users (reserved domain) and Playwright users never reach PostHog: `opt_out_capturing()` when the email is on the reserved or test domain. Their Sentry events are tagged `synthetic=true`, and alert rules ignore that tag, so the window neither emails the owner for every error nor skews dashboards. Those errors are still recorded, and every E5 run reviews them. The G-verify drill's deliberate errors come from a real admin session, so they still alert.
9. **G9 Self-hosted LLM tracing in our own Postgres** (owner, 2026-09-28: keep observability in-house and add no new SaaS; Langfuse and LangSmith rejected). The custom eval harness (`server/evals/`) stays the **source of truth and the release gate**: offline by default, deterministic, and run in CI. Tracing adds four pieces:
   - **`ai_private.ai_trace_spans`**, one row per provider call and per pipeline stage. It records:
     - turn ID, stage, model snapshot and prompt version;
     - input/output tokens, cost and latency;
     - outcome (ok, refused, timeout, invalid-output or provider error) and retry count.

     It holds **no content**: the stored conversation and results already live in the turn tables. It cascades from the turn row and is purged with it, so the 7-day expiry and forget/delete (O09) cover traces automatically.
     - Only `ai_service` can write to it.
     - Operators can read it through a non-exposed view.
     - Revoke from `public`, `anon` and `authenticated` (F17).
   - **Prompt versioning.** Prompts live in git as files. Each call records the prompt's content hash, so any trace or eval result ties back to the exact prompt text.
   - **`evals compare <runA> <runB>`**, a CLI that prints per-objective and per-slice deltas between two harness runs: the "experiment comparison" that Langfuse would provide. The harness also records its runs as spans against a local DB, so eval and prod traces share one shape.
   - **Operator inspection.** SQL views (`ai_turn_timeline(turn_id)`, slowest stages, and the latest errors by prompt version) run from the SQL editor, with no new UI. If the AI plan's operator surface already includes a turn inspector, it reads these views.

   Once built, a single OpenTelemetry-shaped adapter behind the provider client keeps an export path open: self-hosted Arize Phoenix can be added later if debugging needs a UI. Nothing leaves our infrastructure in v1, so D6 needs no new processor row.

**Verify:**
- Unit tests show every registry action and cron is instrumented, and the Python `before_send` scrubber drops bodies and keys.
- In the E3 window, a deliberate test error per surface appears in Sentry with a readable stack trace and fires its alert.
- A disabled cron raises a missed-check-in alert.
- A G4 threshold is forced and alerts.
- PostHog shows no synthetic users after the window.

## Verification

- `grep` the four docs for leftovers: "capability" outside the ingress-fallback note, "event stream", "two always-ready", "cluster" in A0/A1, `config.py:153`, `worker.py:368`.
- Check that every `[..](..)` link resolves and that the R57–R89 rows map one-to-one to F1–F33. Grep for the leftover lines "no current member loses access" and "controlled recruiter rollout", and for Connect on cards/Posted-by.
- Re-add up the F3 deadline arithmetic and the eval fixture (89/49), which is unchanged.
- Check that the tunables table values match the sections they cite.
- Run `graphify update .` afterwards, per CLAUDE.md.
- **Approval starts execution immediately, in this order:**
  0. Part 0 graphify refresh, skill update and hook install.
  1. Part A doc edits and the programme files (`tasks/todo.md`, `docs/launch-readiness-programme.md`).
  2. Part B fixes (B1–B27, B29; B30 at the start of A0), plus the E1c metrics (M1–M5), so every later change is measured. Then the E1b Stage 1 local optimisation loop, then the Stage 2 loop.
  3. Part C loading UX.
  4. Part F extras (toast, notifications, data export, incident banner; uptime-monitor config handed to the owner).
  4b. Part G observability refresh (G1–G8). G9's tracing hook is built with the AI adapter in A0. Each new AI surface adds its G1 row, Sentry capture, PostHog enum events and G4 queue check as it's built.
  5. Part D audits, fixing what they find.
  6. AI, in this order:
     - the "Now, independent of AI" steps: F15 privacy copy (wording from the owner) and the F25 `cv_worker` role with B13 `sslmode`;
     - B30, the line-by-line audit of the AI source docs;
     - A0 → A1 → A2 → A3 per the amended AI-plan, with the eval harness and G9 tracing.

  Each item follows its verify column and uses failing-first tests (run against the old code to prove they can fail). Every Playwright run rebuilds first. Each phase ends with a full local run of all of these, all green:
  - lint, typecheck and Vitest;
  - pytest;
  - rls_smoke, adversarial_edges and admission_roles;
  - the full Playwright suite, including the new mobile, throttled and axe projects;
  - `graphify update .`.
- **Only when everything passes locally:** the E2 release train to prod (owner-run steps), then the E3 pre-launch window with the E4 prod subset and the E5 k6 programme and cleanup, then the E5b committee acceptance test, then E6 go/no-go and launch. A failure at any gate returns to the fix → local re-test loop before continuing.
- **Stop and ask conditions:**
  - a finding that needs an owner decision (product, legal or spend);
  - any prod-touching step;
  - a fix that would change documented behaviour members rely on.
- Owner-only steps are marked "Owner" in todo.md and never done by me: dashboard settings, `supabase db push`, VM env switches, the prod test window, merges and launch.

---

## Carry-over map (Part A step 5, done 2026-09-28)

Every open item in the earlier plans, mapped to a programme ID or closed with a reason.

| Source | Open item | Now |
|---|---|---|
| old `tasks/todo.md` | S3 CV/GitHub dialog polling | B8 + B20 |
| old `tasks/todo.md` | S4 staging load test (100 → 250 → 500, p95 < 5 s) | E1b gates (stricter) + E5 in the E3 prod window; no staging project exists |
| old `tasks/todo.md` | O1 Supabase Pro + Small | Pro done; compute is **Medium** (E1a) |
| old `tasks/todo.md` | O2 Resend Pro for launch | E6a |
| old `tasks/todo.md` | O3 Auth per-IP limits | E1d / E6a (500 per 5 min) |
| old `tasks/todo.md` | O4 Redis split boot-log check | E6a |
| old `tasks/todo.md` | E1–E3 email → ACS | Post-launch (launch stays on Resend Pro) |
| old `tasks/todo.md` | C1–C3 ship Connections | Closed: live 2026-09-24 (PR #111) |
| old `tasks/todo.md` | L1 domain checklist / L2 edge-case pass | E6a / E4 + E5b |
| old `tasks/todo.md` | A0–A3 | AI phase 6 (amended AI-plan) |
| old `tasks/todo.md` | Azure Postgres + Clerk analysis | Post-launch |
| old `tasks/todo.md` community archive | Azure provisioning; Vercel env + `app_config` rows | Closed: gateway and community are live; re-checked by the E2 smoke |
| old `tasks/todo.md` community archive | flip `community_posts_enabled` | Verified in E2 step 3 (flags) |
| old `tasks/todo.md` community archive | DPO sign-off on `post_moderation_log` surviving deletion; OSA risk assessment | D6 |
| old `tasks/todo.md` community archive | add `post_moderation_log` + `post_reports` to the manual dump | B16 (`scripts/db-backup.sh` covers them) |
| `after-supabase-pro.md` §0 | digest URL seed | Closed: seeded 2026-09-24; domain-change re-run is in L1 (E6a) |
| `after-supabase-pro.md` §1 | Resend Pro, digest cap 800, Auth email limit, showcase nudge URL, delivered-mail check | E6a / E1d |
| `after-supabase-pro.md` §2 | Pro, compute, spend cap, backups + restore, leaked-password protection, Auth limits, CAPTCHA, capacity checks, uptime | E1a / E1d / F-x1 |
| `after-supabase-pro.md` §2 | "staging load test", p95 < 5 s | Replaced by E1b/E5; the doc is corrected to point there |
| `after-supabase-pro.md` §3 | Vercel Pro | E1d |
| `scalability-audit.md` §7 | live checks after deploy (verify_prod_schema, digest URL, two-account round trip, cooldown, next-morning digest, kill switch) | E6a "Connections handshake steps" |
| `scalability-audit.md` §7 | S4 on Pro | E1b/E5 |
| `cv-matchmaker-spec.md` | unimplemented matching/agent sections | Superseded by AI-plan.md (its header says so); built in AI phase 6 |
| 2026-09-11 plan | B3.4 stable image route | Closed: `/api/img/[purpose]/[key]` exists (hardened by B2) |
| 2026-09-11 plan | B3.6 Cloudflare surge runbook | Closed: written in that plan's Phase 3 |
| 2026-09-11 plan | B2.8 pipeline load test (500 GitHub connections, 1 vs 3 workers) | E5 "Polling + uploads" row, run locally with `server/scripts/b28_load_test.py` |
| 2026-09-11 plan | C2 re-measurement against prod | E5 in the E3 window |
| AI docs | every open AI item | AI phase 6; findings F1–F33 applied (R57–R89) |
