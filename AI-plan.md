# Foundry AI — revised implementation plan

Reviewed 2026-09-25 against working-tree HEAD `8fb8290`. This is the current matching
plan, replacing `/Users/varunnayak/.claude/plans/we-are-now-ready-virtual-gadget.md`
and the unimplemented matching/agent portions of `cv-matchmaker-spec.md`.
The external original is unchanged. Findings and evidence: [AI-plan-review.md](AI-plan-review.md).

Updated 2026-09-26: cross-chat clustered memory and posting-level eligibility are now explicit
requirements. “Alumni” means graduates regardless of directory affiliation. The owner confirmed
jobs for Students / Graduates / Both, with each posting's audience enforced; graduate members
remain eligible to apply to matching jobs. The owner selected approximately one week of chat
history: use a rolling seven-day lifetime, including derived chat memory (§5.1).
Updated 2026-09-26: consolidated the data, privacy, matching, lifecycle and evaluation fixes into
the build order and acceptance gates (§14). A second gap sweep records remaining verification
limits and release dependencies; this plan is not a guarantee that implementation or legal review
will uncover no further issues.
Updated 2026-09-26: UX is now a first-class build/release objective (§12), including improvements
to incumbent directory/opportunity interactions and formative usability checks. Capacity acceptance
now targets 500 concurrent authenticated users, bounded AI admission and a 1,000-user headroom run
(§14); this is a test requirement, not a claim about current capacity.
Updated 2026-09-26: deployment topology now explicitly avoids a third user-managed VM, compares ACA,
Vercel Functions and co-location tradeoffs, keeps interactive ACA capacity warm, and sets read/write,
region, queueing, rollout, telemetry and recovery obligations (§10.1). Existing C6 load-test failures
are treated as an unresolved capacity blocker, not evidence of production readiness.
Updated 2026-09-26: the owner reports a separate k6 run that handled 50 concurrent users but failed
at 100. Its target environment, script revision, thresholds and failure signatures have not yet been
recorded, so it is a blocking signal to reproduce and diagnose, not a capacity number to extrapolate.
The launch target remains 500 concurrent authenticated users for a projected directory of about
2,000 members; moving to paid provider tiers is a prerequisite for representative staging, not proof
that the target is met.
Updated 2026-09-26: added production active-turn monitoring and a staged operator procedure for
raising the global concurrency ceiling, with privacy-safe metrics, headroom gates and rollback (§10.1).
Added stage-by-stage latency audits during development/release and role-separated admin/operator
visibility for capacity, health and audited limit changes without exposing member content.
The complete migration/data review is [AI-data-audit.md](AI-data-audit.md), with a
[134-file source inventory](docs/ai-migration-inventory.md). Use both specific tools and broad
capabilities in relevance scoring (§7.3). The custom objective-based evaluation harness is specified
in [AI-evaluation-plan.md](AI-evaluation-plan.md) and is a required implementation deliverable.

**Audit 2026-09-27/28.** A third review pass (findings F1–F33, recorded as R57–R89 in
[AI-plan-review.md](AI-plan-review.md)) corrected contradictions in the execution/security model
(no-ingress lease authority, polling not streaming), deadline and concurrency arithmetic, spend-vs-
capacity sizing, existing spend controls, Connect placement, executor RPC exposure, admin-created
jobs, audience cutover, deletion paths, job runners, staging assumptions and Playwright coverage.
Owner decisions from that pass are recorded in §1. All limits are collected in the
[Launch tunables appendix](#appendix-a-launch-tunables). This plan is now executed as part of the
[launch-readiness programme](docs/launch-readiness-programme.md) (phase 6, after the current-app
fixes). "Staging" in this document means what F33 defines (§10.1).

**Status: reviewed and corrected design; no feature implementation or deployment in this review.**
Material flaws were found, so the owner's conditional instruction to implement if the
review found no problems did not trigger. The controls below are requirements, not claims
that the current application already enforces them. Live infrastructure, provider account
settings, legal applicability and performance remain to be verified at the stated gates.

## 1. Product decisions and boundaries

Ship **Find best candidates → Build your network → Find opportunities**, behind independent
server-enforced flags, all initially off. Preserve the existing directory and application flows.

- Recruiter access requires an approved member who owns an **approved, open job** in
  `opportunities`, with `application_deadline >= current_date`. Events and `vcs_grants`
  never qualify. Recheck this on every operation and result read; do not wait for expiry cron.
- One job per recruiter conversation. Switching jobs opens its separate thread; never combine
  requirements or scores across jobs. Pending listing edits are not approved job content.
- Chat-style refinement ships with recruiter mode: subsequent messages update bounded search
  criteria. This means “Deep Learning” then “must also like chess” retains both conditions in
  network mode. It does not mean sending the whole transcript to OpenAI.
- Recommendations are advisory. No automatic rejection, application, contact or drafted outreach.
  Connect retains its existing consent, block, quota and cooldown checks.
- **Connect stays dialog-only (owner, 2026-09-23; reaffirmed 2026-09-27, F16).** AI result cards
  and opportunity "Posted by" rows show **View profile**, which opens `MemberDialog`; Connect/
  Pending lives only inside that dialog. No exception for AI results.

**Owner decisions, audit pass 2026-09-27/28 (F16–F33):**

- **Admin-created jobs (F18):** candidate search on jobs created through
  `admin_create_opportunity` does not exist in v1, and there is no "on behalf of" flag. Eligibility
  uses a creation-source marker on the row, not "poster is not an admin": every committee member
  will be an admin, and a job an admin posts through the normal member flow still qualifies.
- **Indexing owner (F26):** the existing CV worker builds member/job search projections, JD
  requirements and their embeddings, under the scoped `cv_worker` role and the metered ledger. The
  ACA executor runs turns and query embeddings only and never reads raw CV/GitHub sources.
- **Rollout (F27):** no pilot list. Per-mode flags are all-or-nothing, turned on for everyone after
  the gates pass; flags remain the rollback.
- **Cold start (F28):** recruiter mode launches together with the opt-in controls, accepting thin
  early results. The low-result state says plainly that few members have opted in so far, without
  naming anyone; the admin dashboard tracks the opted-in ready-projection count.
- **Audience cutover (F29):** enforced immediately. Unconfirmed members see no audience-restricted
  jobs until they confirm, via one "Confirm your status to see jobs" prompt rather than an empty
  board. Intake asks the education question so new members are never unknown.
- **Clustering (F10):** deferred; ships only if evals show retrieval misses (§5.1).
- **Launch order:** all three modes ship and pass their gates before the public launch.
- Numeric scores describe **evidence matching these criteria**, not intelligence, employability,
  a probability of success or an objectively verified skill level.
- No connection-graph signals in v1, including opaque boosts. No names, email addresses or member
  IDs as search criteria. Result references are scoped to a specific prior turn.
- Keep each member's permitted chat history retrievable through a private clustered memory graph,
  including previous chats within a rolling seven-day lifetime (§5.1). This supersedes the
  earlier 30-day/no-cross-chat rule.
- Candidate CV quotations require a separate evidence-sharing choice, off by default, with a
  preview. Merely agreeing to ranking must not silently publish CV sentences.

**Owner direction, follow-up 2026-09-25:** opting out means complete removal from recruiter
shortlists, not continued ranking on public fields. The owner asked whether participation should
instead be compulsory; that alternative has not been selected. Recommendation: keep discovery
voluntary for every affiliation, independent of CV upload requirements. Use separate
`ai_recruiter_discoverable` and `ai_network_discoverable` choices,
both off by default, rather than a single ambiguous combined switch. Network AI discovery also
defaults to opt-in; ordinary directory visibility is unaffected. The owner can choose public-only
network matching after the LIA/notice/objection mechanism is settled. Do not silently ship that
alternative. The user's own job matching does not require permission to recommend them to others,
but does require a first-use processing notice and existing source-processing consent.

**Verified intake rules:** `20260901000013_intake_role_gates.sql` and `frontend/src/components/intake/IntakeFlow.tsx:186`
require a CV only for `student` and LinkedIn for everyone; this includes the Skip-for-now path.
`20260912000001_students_cv_required.sql` also prevents students removing their CV without a
replacement. Alumni, recent graduates, mentors, angels and staff/faculty have optional CVs.
These are repository rules, not a claim that production migration state was checked.
CV upload, permission to process it, AI discoverability and permission to share quotations are
four different choices/requirements. Never automatically opt a student in because upload is
compulsory. Never require an alumnus to upload a CV just to enable discovery. LinkedIn being
required is neither permission to scrape it nor evidence that its work history is in our database.
An opted-in member without a CV can match on permitted member-entered skills/bio and optional
GitHub evidence; experience remains unknown unless explicitly supplied or evidenced.

The current intake copy (`frontend/src/components/intake/screens.tsx:356`) implies uploaded CVs are used for recruiter matching.
Rewrite it alongside the new controls so it does not imply compulsory AI ranking. Reassess the
existing compulsory student upload's purpose/necessity in the DPIA rather than using the old
requirement to justify a new processing purpose. No upload-rule change is authorised by this plan.

**Student-only ingestion proposal:** retain the present role-dependent upload requirements and
consented optional ingestion for other roles in the recommended design. Ingestion permission,
being discoverable to recruiters, job visibility, applying and posting are separate policies.
Removing alumni CV ingestion would not remove alumni's profile/GitHub signals, and it would
make their own job matching less informed; it is not an eligibility or ranking control.
The owner has confirmed Students / Graduates / Both jobs, so graduate members retain access to
eligible postings. No existing graduate data is deleted as part of this planning update.
**Correction (F29):** enforcing audiences does change access: a member whose education status is
unknown satisfies no audience, so they lose sight of audience-restricted jobs until they confirm
their status. The owner accepted this (enforce immediately); the confirm-status prompt and the
intake question keep the impact small, and pre-launch prod is admin-only.

## 2. Verified baseline and useful information

Ingestion exists; matching does not. `agent.py` is a docstring. `cv_profiles.profile.skills_raw`
and project technologies retain specific terms beyond the broad taxonomy. GitHub signals contain
languages, themes, selected repositories and potentially identifying README/URL fields.

“Public” below means visible to approved directory members, **not public on the internet and not
automatically lawful to repurpose**. Visibility and consent are separate checks.

| Signal | Current source and evidence | Planned use |
|---|---|---|
| Course, affiliation, graduation year | `profiles`; directory cards | Network filters; self job search. Recruiter education/availability constraints only when job-relevant and explicitly supported; no default age proxy |
| Broad skills, sectors | `profile_skills`, `profile_sectors` | All modes, labelled member-selected; never imply specific framework proficiency |
| Working-on bio, hobbies bio | `bio_focus`, `bio_hobbies` visibly rendered by `MemberDialog` | Network interests and focus after local minimisation; hobbies excluded from recruiter scoring |
| Structured interests and intents | `profile_interests`, `profile_intents`; owner/admin SELECT policies | Network under its consent; self preferences. Only explicit availability/job intent can affect recruiter matching |
| Specific tools and methods | Current ready `cv_profiles` skills/project technologies; underlying source evidence | Exact framework matching; preserve FastAPI, PyTorch, RAG and scikit-learn rather than replacing them with broad taxonomy labels |
| Role tasks, project contributions, technical depth | Current CV extraction plus verified source spans | Bounded evidence-based fit; distinguish listed skill from demonstrated use, and personal contribution from team/project claims |
| Degree subject/level; relevant duration | CV education/roles, dates processed locally | Use only justified requirements. No institution prestige, age, birth date, graduation-year prestige or employment-gap penalty |
| GitHub languages and technical work | Effective member-selected showcase and consented technical signals | Supporting evidence; no popularity/star count, follower count or repository count as quality proxies; no README instructions |
| Desired location, commitment, role type | Existing structured fields only where actually present; otherwise explicit user criteria | Self job preferences. Unknown stays unknown; never infer location from address or right-to-work from nationality |
| Venture/recruiting intake fields | Not rendered by current member dialog; `20260901000009` explicitly grants column reads and profile RLS permits other approved members | Current scalar intake fields are not owner-private. Use purpose-consented projections and separate owner-only work preferences; review existing disclosure before promising privacy |
| Contact details, names, photos, handles, links | Profile/CV/GitHub/listing fields | App-only identity/contact rendering after permission checks; excluded from all model payloads |
| Sensitive attributes or proxies | May occur anywhere in free text | No matching, inferred attributes, embeddings or evidence about health, disability, ethnicity, religion, sexuality, political belief or criminal history |

GitHub activity is optional. Absence of a CV, portfolio or public GitHub is missing evidence,
not evidence of incompetence. Do not infer private interests from employer, surname or repository.
Record source, source version, freshness and whether each fact is member-selected, extracted or
verified against source text. “Preview what AI uses” shows the actual projection for each mode.

Existing opportunities already display “Posted by” name and LinkedIn. Add avatar and **View
profile** (opens `MemberDialog`; Connect stays inside the dialog, F16); extend `Opportunity.postedBy`
and the data mapper to carry a permitted poster member ID. Do not
label a poster “hiring manager” unless the product actually collects that relationship.

### 2.1 Migration-derived feature requirements

The [data audit](AI-data-audit.md) maps every usable source to each mode and distinguishes existing
data from proposed fields. Its feature requirements are part of this plan:

- Keep directory `skills` and extracted `cv_skills` separate. Broad-tag aliases often name specific
  tools; no reverse inference. `member_skills.confidence` is currently cosine mapping similarity,
  not proficiency. Exact identity uses reviewed aliases/raw evidence before approximate retrieval.
- Extend evidence assertions to specific methods and nonsoftware skills, source-linked roles/
  projects, polarity, demonstrated versus aspirational use and unknown dates/versions. Preserve
  unmapped terms. Version the taxonomy seed, which is populated outside migrations.
- Support no-CV, GitHub-only and manual evidence projections. GitHub skill rows currently capture
  languages; permitted frameworks/methods need independent source-grounded extraction. Excluding
  Shell/HCL language metadata cannot exclude evidenced Bash/Terraform work. No repo-star bonus.
- Recruiter A1 includes poster/admin confirmation of parsed requirements and a criterion/evidence
  matrix. Separate published requirements from search refinements and unknown from disqualified.
- Network A2 includes explicit seek/offer intent and purpose-specific availability; distinguish
  shared interests from complementary expertise. Existing `profile_intents` describe wants only.
  Respect open-to-connections, existing/pending contacts, blocks and cooldowns without popularity
  scoring or private relationship disclosure.
- Opportunities A3 separates capability match, education eligibility and personal preferences.
  Add optional owner-only work preferences and structured job logistics; existing pay/location
  text and generic intake availability are insufficient. Reuse applied/bookmark state without
  interpreting clicks as application outcomes. Keep Apply independent of numeric evidence score.
- A0 must reconcile manual `admin_delete_graduates` with retaining graduate members: recommend
  retire graduation-year bulk deletion in favour of status confirmation/transition, preserving
  normal deletion rights. Audit secure email/auth transition and preserve member identity. No
  automatic degree-completion inference and no live account deletion in this review.
- New confidential fields live in owner-scoped tables/RPCs. Existing scalar intake grants need
  explicit review; UI omission is not access control. Version child rows, showcases, taxonomy
  and consent changes explicitly; `profile_version` is intake completion, not a cache epoch.

The unimplemented `server/app/agent.py` docstring still permits hidden social-graph ranking and
sketches obsolete tools/tables. Those instructions are superseded by this plan's no-social-signal,
bounded-pipeline contract; reconcile that docstring when implementing A0/A1, not by adopting it.

## 3. Privacy boundary, including existing ingestion

The honest requirement is **no direct identifiers, contact details, secrets or sensitive facts
in outbound AI payloads**. The remaining skill/experience data is pseudonymised personal data,
not guaranteed anonymous: a distinctive project can identify someone. Regex cannot guarantee
anonymity or detect every address, name or indirect identifier. Document residual risk in the DPIA.
If the owner requires literally no personal data to leave Foundry, external CV-based extraction
and assessment must be replaced with local processing; `store:false` does not solve that.

Create one locally executed, versioned outbound projection boundary, with typed payloads and
strict byte/token limits. Apply it **before the first remote call**, including moderation,
embeddings, extraction, JD parsing, GitHub selection and summary regeneration. Nothing may call
the provider with an unvalidated arbitrary dictionary or raw source text.

1. Normalise safely, bound input, detect known secrets and contact patterns, and remove direct
   identifiers using known member identifiers plus local entity detection and context rules.
   Use locale-aware phone/address handling. Preserve technical tokens such as C++, C#, .NET,
   Node.js and R; ambiguous names like Go require context. Do not damage multilingual text just
   to claim stronger security.
2. Allowlist fields for each purpose. Exclude links, handles, organisations/institutions where
   unnecessary, exact dates, titles that identify private projects, and unsafe source spans.
   Run a final local detector on the **assembled payload**, not only individual input fields.
3. Quarantine uncertain free text from model use; offer member correction or a skills-only
   fallback. No external PII detector may receive the very identifiers we promised to keep local.
4. Validate provider responses with full nested schemas, enums, lengths and finite values.
   Strict Outputs is useful, but refusal, truncation and malformed/misbound responses still fail
   closed. Current extraction only checks missing top-level keys; extend its validation.
5. Avoid logging prompts, source spans, free text, request bodies, tokens or exception payloads.
   Configure Sentry `before_send` and HTTP instrumentation explicitly. The current worker has
   no reusable PII scrubber, despite the previous plan implying one existed.

Preserve original upload bytes under existing storage access/retention rules; do not promise
the uploaded CV itself is anonymised. Separate source hash from sanitised text hash, and include
extractor, sanitiser and projection versions in dedupe checks. `extract-v8` alone is insufficient:
the worker currently reactivates old ready rows by text hash before any new extraction.

Backfill all derived surfaces, not just `cvs.raw_text`: structured profile JSON, summaries,
chunks and vectors, member skills, GitHub projections, downstream search documents and caches.
Mark old versions unavailable to matching until reprocessed. Regex-only mutation of chunks is
not a complete backfill. Use resumable, checkpointed, budgeted jobs; validate new data before
atomic promotion. Old versions cannot reappear through upload dedupe. Original storage,
database backups and processor retention need separate retention/deletion documentation.

Changing ingestion storage is a functional migration: preserve member-facing profile extraction,
link handling and evidence provenance. Parse allowed self-profile links locally into a separate
non-model field rather than relying on an LLM to recreate redacted URLs.

## 4. Bounded search pipeline and off-task controls

The model receives no tools, SQL, code execution, filesystem, web access or arbitrary fetch URL.
The backend follows fixed stages. There is no agent loop or generated general-purpose answer.

| Stage | Contract |
|---|---|
| Admit | Verify the member session (user-session admission RPC, F1), live approval, mode/job eligibility, expected spec version, body size, request/concurrency quotas and feature flags |
| Minimise | Local outbound policy from §3; reject unsafe payloads before moderation or any other provider call |
| Moderate | Bounded moderation request on minimised input; harmful/uncertain cases stop or seek review, never classify task relevance solely from moderation |
| Interpret | One bounded scope/criteria call, or a trusted structured UI command; model sees current validated spec, current minimised message and bounded authorised memory (§5.1), never the full transcript |
| Validate | Enforce operation schema, allowed fields per mode, source references, sensitive-criterion policy and limits; no retrieval on invalid/ambiguous input |
| Retrieve | Current eligible SQL projections; exact/filter/lexical/vector union, at most 200 IDs and compact deterministic features |
| Assess | Up to 20 candidates, at most four five-candidate batches; only uncached supported evidence questions |
| Score | Deterministic, evidence-bound score and eligibility tiers; no final score supplied by the model |
| Publish | Recheck eligibility/source versions, persist normalised results, hydrate identity through the viewer's authorised result RPC |

Initial planned models remain `gpt-5.4-mini` for interpretation and `gpt-5.4` for recruiter
assessment; network/opportunity assessment may use mini if it passes the same evaluation gates.
Pin evaluated model snapshots and schema/prompt versions before launch. Use Responses with
`store:false`, explicit timeout, output/token caps and no tools. A dedicated async client avoids
the existing sync worker client's credential coupling and event-loop blocking. Do not import
`worker_settings()` or the storage-dependent CV module into the slim AI image merely to embed.

### Relevance means interpreting the requested operation, not detecting topic words

- “Find people who teach Pythagoras” is a people-search criterion and can be legitimate.
- “Explain Pythagoras” and “write Python to reverse a linked list” are off-task.
- “Find PyTorch people and also explain Pythagoras” is mixed. Return a static notice and proposed
  safe criteria; require one tap on **Search with these criteria** before retrieval/assessment.
  Do not answer or reflect the off-task fragment. Suspicious mixed injection requests are refused.
- Ambiguous, ungrounded or unsupported sensitive requests leave the previous spec unchanged.
  A moderation classification is not a relevance classification, and a moderation flag is not
  automatically proof of malicious intent (medical research is a legitimate domain).

The interpreter returns enums, canonical term IDs, typed operations and source-span offsets,
not `ignored_fragments` text or a free-form explanation. Validate each proposed value against
the current message, a server-stored earlier atom or the approved JD; no fuzzy grounding.
Aliases come from a reviewed dictionary, never an embedding similarity threshold.
Unknown legitimate concepts may be bounded `free` criteria with exact source provenance and
local policy validation; they are not automatically promoted into the trusted global dictionary.

User-visible labels come from trusted dictionaries or locally validated source spans. No model
prose is displayed in chips, titles, clarification, refusals or “why” text. Render plain text;
no Markdown links/images, HTML or generated URLs. Criteria, CVs and JDs are all untrusted data.
Verbatim evidence alone does not make an instruction safe to display.

Replace token/stopword “fast path” with a small, fully consumed grammar for known terms and
explicit operators. It must preserve NOT/AND/OR, required vs preferred, and ambiguous terms.
Chip operations use typed commands. A dictionary hit is not authorisation to use a criterion in
recruiter mode. No dynamic query term can poison another user's alias map.

The security guarantee is bounded operations/data/cost, not perfect semantic classification.
A malicious document can still bias multiple ratings; batching does not limit compromise to one
rating. Omit instruction-like evidence, validate candidate-to-evidence binding and test cross-card
contamination. No format or system prompt eliminates all prompt injection.

Rate-limit every rejected attempt. Reserve actual interpreter work, but do not assess candidates
for rejected/clarification turns. Escalating cooldowns target repeated high-confidence abuse;
ordinary off-topic mistakes and ambiguous inputs receive guidance without account punishment.
Separate abuse state from a deletable conversation; provide a human review route.

## 5. Conversation memory and semantic correctness

Store `SearchSpec {schema_version, revision, mode, posting_id?, approved_posting_version?,
audience_scope, atoms, groups, excluded_result_refs}`. Atom: stable ID, kind, canonical value, comparator,
required/preferred, weight, source and source version. Modes have separate criterion allowlists.

**Recruiter audience filter, revised 2026-09-26:** Students / Graduates (all affiliations) / Both
uses the educational eligibility facts in §7.2, not `profiles.role IN ('alum','recent_grad')`.
The earlier role-union proposal is superseded because it would miss graduated faculty/mentors.
Directory affiliation filters may still narrow separately; they never define whether someone
has graduated. Current postgraduates can satisfy both educational conditions and appear once.

Persist a nonempty validated audience scope in each spec/turn. The effective pool is the
intersection of the approved job's eligible audience, the recruiter-selected search scope,
current candidate eligibility and discovery consent. Narrowing a Both job to Students is allowed;
a search cannot widen a Students job to non-students. Apply this before top-k and recheck on
publication/replay. Empty selections disable Run. Default to the job's audience, visibly labelled.

Include audience/eligibility versions in retrieval fingerprints and idempotency digests. Switching
scope keeps independent evidence assessments, but new candidates still need budgeted execution.
It does not mutate the job's published audience; only the posting's approved edit flow can do that.

- Initial limits: 12 atoms, four flat OR groups, ten result exclusions. **No arbitrary limit of
  three required criteria.** A job can require more; a parse exceeding the overall limit needs
  explicit simplification, never silent dropping. Every parsed requirement remains accounted for.
- One grammar defines evaluation: AND across ungrouped atoms; OR within each group; NOT is an
  explicit operator. Validate dangling IDs, contradictory constraints and empty groups.
- Required means required, including free-text requirements. A matching result must have supported
  `met` evidence for every required atom/group. Unknown is not met. Related tool credit never
  satisfies an exact required framework. Relaxation is a visible user choice, not an automatic run.
- “Both / either / replace” appears for ambiguous follow-ups. Until resolved no spec update or
  candidate assessment occurs. One-step undo restores a validated prior spec revision.
- References use `(turn_id, slot)`; never map “#3” against a moving latest result list. Old result
  references must still be authorised and consented. More-like-this uses only the current
  allowed projection and is disabled in recruiter v1 to avoid opaque similarity/bias effects.
- Maximum one running turn per conversation and two per member. Expected revision + compare-and-
  swap prevents two tabs overwriting each other. Client idempotency key is unique within owner
  and conversation; a different body with the same key is a conflict.
- Store minimised source messages/history and source spans for active criteria. Retrieve a bounded
  context packet from that archive; do not replay the entire history into the model. History lifetime
  follows §5.1; titles are user-entered/sanitised or deterministic, not extra LLM calls.
- A job edit invalidates its parsed requirements until the new approved version is ready. Existing
  threads offer an explicit update to that version. Closure/withdrawal/expiry makes them read-only.
  Old scores are historical, not a match to changed job text.

### 5.1 Graph-based memory layer — included in the first release

> **Amended 2026-09-27 (F10): clustering is deferred.** A seven-day window at 40 runs/day is at most
> about 280 messages per member, which owner-scoped keyword and vector search over the source
> archive already covers. The first release keeps the typed criteria/concept/evidence/dependency
> graph and the source archive (that is where reuse, cost savings and provenance come from). Scoped
> clusters, cluster summaries and small-model regrouping described below move to a **deferred step
> that ships only if evals show retrieval misses** (AI-evaluation-plan §7 ablation). Where the text
> below mentions clusters, read it as that deferred step; source-span search is the v1 path.

The owner explicitly wants a knowledge/memory graph to reduce repeat processing. Implement a
small **typed evidence and search graph in Postgres**, alongside the existing vectors. It is
an application feature, distinct from the development-time Graphify codebase graph and from
members' private social connections. It records source messages, facts, criteria, provenance,
dependencies and clusters across the same member's chats. It never infers personal relationships,
protected attributes or behavioural suitability from what someone has searched for.

| Memory | Nodes and edges | Work reused |
|---|---|---|
| Conversation | Conversation → versioned criterion; criterion → canonical concept; AND/OR/NOT/required typed relations; turn → scoped result reference | The interpreter gets current criteria plus the new message, not the full transcript |
| Concept | Reviewed tool/area/interest concepts; `alias_of`, `related_to`, `part_of` with type/version and bounded weight | Canonicalisation, exact matching and reviewed transferable-skill credit without repeated model judgement |
| Evidence | Member → purpose-scoped source fact → skill/project/experience; fact → immutable source span/version | Reuse extracted facts and deterministic coverage instead of rereading a CV for each recruiter |
| Assessment dependencies | Assessment → criterion/context and evidence-set fingerprint; evidence → source version | Reuse valid judgements and identify which work becomes stale after a CV/GitHub/profile/JD change |
| History clusters | Member → chat → message/span; span → grounded memory item; scoped cluster → member-owned items; correction/supersedes edges | Retrieve relevant context from previous chats while preserving the source and distinguishing past intent from current instructions |

Use normalised typed relations with actual foreign keys, not a generic JSON graph that bypasses
deletion/RLS. Concept tables hold no member identities or private criteria. Member evidence,
conversation nodes and assessment dependencies retain purpose, owner, consent epoch and source
versions. Existing `member_search_docs`, evidence and assessment tables remain authoritative;
graph edges reference them rather than maintaining an inconsistent second copy of source text.

Populate edges deterministically from validated ingestion outputs, member edits and accepted
SearchSpec operations. Existing extraction calls may supply validated provenance, but no separate
LLM “graph builder” runs on every turn. No arbitrary recursive traversal from user/model input:
typed joins, at most two concept hops, fixed edge/row limits and the same eligibility checks as
retrieval. A `related_to` edge never becomes an `alias_of` edge or satisfies an exact requirement.

Example: “Deep Learning” creates a criterion node. “Must also like chess” adds a required interest
node and an AND edge. Reuse the first criterion's current assessments; test chess through permitted
structured interests where possible. Interpreting the second natural-language message may still
cost a call, and newly discovered candidates may need assessment. There is no promised zero-cost
refinement merely because its concepts already exist in the graph.

Start with conservative projection-hash invalidation from §8. Narrow invalidation may reuse a
context-free assessment only when the complete evidence set consulted for that criterion is
unchanged. Dependencies on *absence* must include the eligible evidence-set version, not just
positive supporting spans, or a newly added PyTorch fact could leave a cached “not evidenced”.
Whole-job judgements depend on the entire relevant context. Consent/policy changes invalidate
permission immediately regardless of whether the content hash changed.

Persist shared nonpersonal concepts and consented current facts across searches. Personal chat
history, private clusters and preferences are strictly owner-scoped even when two users search
the same job. No organisation-wide chat memory. Private search terms must not enter the public
concept dictionary automatically. Deletion and consent rules in §§6,8,11 cover graph data too.

**Source archive and coverage.** Preserve every permitted, minimised user message and accepted
system response/spec change in a source archive, linked to its thread, timestamp and revision.
The graph is an index, not the sole copy: a summary cannot losslessly represent every statement.
Every retained message has a graph node and indexing status, even if no safe structured fact can
be extracted. Details not represented as facts remain searchable through source-span retrieval.
Do not promise storage of secrets/contact details or restoration of deleted data. Off-task/injection
text cannot become reusable preference memory; retain only the minimised rejection event where
the content itself is unnecessary. Candidate CV quotes/results remain live-authorised references,
not permanently copied private evidence inside a searcher's chat memory.

**Context retrieval on each turn:**

1. Authorise member and scope first, including requested source conversation/job. Load the complete
   bounded current SearchSpec, pending clarification and explicit unexpired preferences. Active
   constraints are pinned and cannot be evicted by a similarity score or cluster boundary.
2. Retrieve owner-scoped memory using exact entity/term lookup, lexical search and embeddings
   over minimised items. Clusters provide additional candidates, never an exclusive search gate.
   Search source spans too, including items whose clustering is pending. Deduplicate by source ID.
3. Expand at most two allowed graph hops with explicit node/edge limits. Rank by current intent,
   purpose/job relevance, source authority and validity; recency is a tie-breaker, not a licence
   to replace a user's explicit saved preference. Keep original source references.
4. Assemble an initial <=2,000-token historical-memory budget (separate from the capped current
   spec/message and candidate evidence). Return at most 12 source-backed items, recording selected
   IDs, omitted-count and retrieval version internally. Oversized exact references use bounded
   pagination/clarification rather than silently dropping a necessary constraint or sending all chats.
5. Feed memory as untrusted scoped data, never as developer instructions. Job-specific requirements
   from another thread are suggestions until explicitly imported; “must like chess” in a networking
   chat does not become a global recruiter filter. A new current instruction takes precedence;
   unclear contradictions prompt clarification instead of silently merging incompatible intent.
6. Record grounding for edits back to current text, active atoms or authorised historical spans.
   Conversation retrieval is not a licence to invent preferences or answer off-domain questions.

Provide **Use memory from my chats**, **Temporary search**, **View/edit saved preferences**,
**Forget this item**, **Delete chat** and **Delete all AI history**. Saved chat preferences expire
with their source; no indefinite-memory exception is enabled. A preference is an explicit user
decision, not an inferred personality trait. Disabling cross-chat use stops future
retrieval immediately without misleadingly claiming it deletes history; offer deletion separately.
If a user references another chat while memory is disabled, obtain an explicit scoped import.
Corrections create `supersedes`/validity links; outdated facts may remain in readable history but
cannot re-enter current context as true. Source deletion invalidates every dependent summary,
embedding and cluster membership. A “forget” tombstone prevents background extraction from
recreating that memory from retained history; it stores only the minimal suppression reference.

**Clustering and optional SLM.** Start with deterministic grouping by owner, purpose/job and
concept overlap, with semantic similarity where useful. Update only affected clusters as new
items arrive. An optional small OpenAI model can propose regrouping/merging/splitting or a
source-backed cluster summary in a background queue, not on the critical chat path. This is a
bounded restructuring task: schema returns existing item IDs, proposed memberships and grounded
source references, never new facts, eligibility changes or deletion commands. Validate ownership,
scope, referential integrity and complete item coverage before publishing. Cluster summaries are
derived indexes, not authoritative evidence or display text approved without validation.

SLM work is coalesced after an idle interval and a minimum changed-item threshold (initial tuning
values: five minutes and 20 changed items), at most once/member/day, with bounded batches/input/
output and the same cost reservations as other provider work. Candidate model is chosen by
measured quality/cost; “small” does not mean local, free or automatically cheaper overall. No new
provider is introduced by default. Publish a new cluster version atomically; retain the previous
valid index during refresh/failure. Fence jobs by source/consent versions so deletion during
reclustering cannot resurrect content. Source search works while new items await clustering.

**Retention: rolling seven days, owner-selected 2026-09-26.** Each message expires 168 hours after
creation (UTC), independently of later activity in its thread. Expired material is inaccessible
at read time even if the purge worker is delayed. Purge source text, embeddings, derived chat
facts/preferences, result snapshots and dependent summaries/cluster edges; recompute mixed-age
summaries from remaining sources. Copying/reclustering or continuing a chat cannot extend source
expiry. Each active criterion carries provenance/expiry: if its supporting chat source expires,
remove it from effective SearchSpec and explain that the user must restate it before another run.
Fresh explicit restatement may create a new source; automated carry-forward cannot. Job criteria
and profile facts remain independently governed authoritative sources, not chat retention bypasses.
Temporary searches have no cross-chat memory and purge at session end or seven days, whichever
comes first. Immediate delete/forget/withdrawal overrides the seven-day ceiling. Show expiry and
empty-history states; no default indefinite saved preferences or chat export cache.

Assessment-cache TTL remains independently capped at 30 days for permitted reusable evidence
judgements, but any cache containing or depending on private chat content inherits its earliest
source expiry and is purged with it. Nonpersonal concepts, current consented profile evidence and
minimised financial/consent records have distinct documented purposes and lifetimes. Backups and
processor retention are disclosed separately, with restore-time deletion replay; do not promise
physical erasure from every processor/backup within seven days. Cover hourly purge, read-time
expiry, clock boundaries, late workers and mixed-age clusters in tests. No live retention changed.

Measure the financial benefit with paired runs at equal result quality: transcript-replay baseline,
bounded-spec/cache baseline and graph-assisted memory. Track total provider spend (including graph
population/refresh), avoided assessment calls, tokens, SQL/storage/worker cost, stale-result errors
and latency. The graph is useful for provenance and selective reuse; its shape alone does not
guarantee savings. Keep a graph optimisation only if it preserves quality/privacy and reduces
measured cost or provides required provenance. Provider prompt caching remains a separate,
opportunistic saving on model calls we still need to make.

## 6. Retrieval, documents and refresh correctness

Use Postgres and pgvector, including the typed memory graph in §5.1. A separate graph database
is unnecessary for the bounded joins in this release. Ship reviewed concept relations and
source/dependency edges; defer automatic neighbour expansion until evaluation warrants it.

Use **separate public and consented projections**, not one combined embedding whose contribution
cannot be removed when consent changes. Source data can be shared; purpose/view projections must
be independently hashed and filtered. The self-opportunity projection may use the member's own
permitted private data even if they opt out of discovery.

`member_search_docs` rows: member FK, purpose/view, source_version, consent_epoch, policy_version,
projection_hash, safe features, safe evidence references, text/tsvector, embedding and model/version,
status, updated_at. Unique `(member_id, purpose/view)`. Public text is also minimised before
embedding. No raw CV, README, email, private URL or arbitrary JSON in this table.

Triggers mark relevant projections **dirty synchronously** and increment monotonic versions on
profile, taxonomy membership/definition, bio, interests/intents, CV currency/deletion, GitHub
selection/disconnect, consent and status changes. The job queue coalesces pending work. Workers
read a versioned snapshot, compute outside transactions and promote with a compare-and-swap.
If the source changed, discard the obsolete result and schedule current work. A job that started
before withdrawal must never restore private data afterward.

Withdrawal/ban/block/deletion is an immediate read deny, including cached/replayed results and
ongoing turn publication. Delete consented projections/assessments and invalidate leases in the
same transaction where appropriate. Every use of a local cache checks current permission/version;
a 60-second TTL is not an acceptable privacy delay. Already downloaded information cannot be
recalled; disclose that limitation accurately.

Retrieval remains fresh each turn. Apply approval, directory membership rules (including committee
exclusion), self-exclusion, blocks both ways, purpose consent, live job status and source-version
checks inside the SQL boundary. Fetch only bounded features, never the whole directory in Python.

Combine exact canonical tool/required filters, lexical results and vector results, deduplicate
member IDs, and return at most 200 candidates. Protect exact framework matches in candidate
generation and preselection; an approximate top-k must not discard all exact matches before scoring.
Only top 20 receive bounded evidence cards; at most ten final cards are shown. Larger pools need a
new budgeted request, not an automatic paid fan-out. Missing exact matches may reflect the cap;
never claim the shortlist exhaustively covers all eligible members.

HNSW post-filtering can underfill results. Benchmark actual parameterised RPCs with selective
consent/course/block filters, inspect EXPLAIN, and compare ANN recall to exact search. Where
supported, use bounded iterative scans; otherwise a bounded exact query over a small filtered
subset or separate purpose index. Set statement, lock and scan bounds. Do not promise one index
scan or sub-50ms performance merely because an HNSW index exists. Verify installed pgvector version.

GIN on canonical arrays/tsvector, appropriate eligibility/version indexes, and HNSW on approved
projection vectors follow measured plans. Avoid global counts on each turn. A connection limit of
600 pooled clients is not a database CPU budget.

Background projection/JD jobs use their own priority and concurrency budget; current `_claim_job`
only orders by creation time and must be extended. Preserve running-job follow-ups and retry
semantics. Add bounded aging/fairness so “low priority” documents do not remain stale forever.
No LLM or embedding request while holding a database transaction; current ingest needs refactoring
where it embeds during profile persistence (`worker.py:366–385`).

**Which process runs this work (F26, owner).** The existing CV worker runs these projection/JD jobs
(extending `_claim_job` as above), under the scoped `cv_worker` role (§10, F25) and the metered
ledger. The ACA executor never claims ingestion or projection jobs.

## 7. Scoring and evidence

Keep synonym equivalence separate from relatedness: reviewed `PyTorch` aliases can be exact;
TensorFlow is related, never an alias. Do not create aliases at cosine >= .92, or universal
related-tool truth at .80. Store versioned, curated relation weights; embeddings may suggest
relationships for review. Broad taxonomy does not prove a particular tool.

Required-constraint satisfaction determines eligibility first. Within eligible results, put exact
coverage of explicitly named job tools ahead of transferable-only coverage in the ordering key,
then use evidence score and stable tie-breaking. The UI labels this ordering. For optional tools,
the owner/recruiter can explicitly choose transferable matches; do not silently treat them as exact.
For otherwise comparable candidates, direct PyTorch evidence must beat TensorFlow-only evidence.

Provisional evidence score, to be calibrated on labelled examples:

- Recruiter/opportunities: 60% criterion coverage, 25% relevant task/project evidence, 15% depth
  of demonstrated work. Omit inapplicable dimensions and renormalise documented weights. No
  double-counting a tool as both exact skill and a broad category unless they express distinct needs.
- Network: weighted criterion coverage only. Exact supported = 1, approved related evidence = 0.5,
  absent/unsupported = 0; show unknown separately. Similarity is candidate generation/tie-breaking,
  **not a pool-min-max component of the visible score**.
- `score = round(100 * weighted_sum / applicable_weight_sum)`. Zero denominator produces
  “Need clearer criteria”, not a score. No blanket 50-point suppression before calibration;
  separate verified matches, possible/unknown matches and no matches.

Scores remain stable when unrelated people enter the retrieval pool. A missing source is labelled
“No evidence available”, not “Does not know PyTorch”. Scores from different criteria/modes are not
comparable. Show evidence completeness and freshness separately. The score is evidence coverage,
not confidence in a hiring outcome. Exactness tiers may outrank a higher general evidence score;
make that visible rather than presenting a misleading numeric sort.

Remove shortlist/contact fatigue penalties from the relevance score: another recruiter's clicks
must not reduce a member's apparent suitability or provide a suppression attack. Respect connection
quotas and show contact state in the UI. Do not feed popularity or shortlist events back into ranking.

The model selects evidence IDs (and optionally bounded offsets) from immutable minimised source
spans belonging to that candidate and source version; the server verifies the binding. Model-written
summaries/chunks are not verbatim original-CV evidence. Retain extraction-to-source provenance;
until verified, show “extracted skill” rather than claiming a CV quote. Quotes shown to recruiters
must have evidence-sharing consent, pass the local sensitive/identifier screen and be <=200 chars.
Return no more than two per candidate. Member-selected and GitHub evidence are labelled as such.

Opportunity cards retain Apply and **View profile** (Connect stays inside `MemberDialog`, F16);
a low score or a short JD must not gate application. Sparse descriptions show “Limited detail — you may want to ask the poster”.
Already-applied is a badge; never reapply automatically. Exclude the viewer's own and expired jobs.

### 7.1 Experience and student/alumni matching — owner-identified ranking risk

The old plan did not adequately constrain experience/seniority scoring. An alumnus with a long
CV could dominate a student internship shortlist, while another alumnus with no CV could be
treated as having no experience. Neither behaviour follows from the actual job requirements.
This is a **design gap to test**, not an observed regression in a deployed matcher (none exists).

Separate three concepts in approved job requirements and the poster's criterion preview:

1. **Eligibility/audience:** Students / Graduates / Both, using the independent education facts
   and migration in §7.2. Poster changes follow approval. No silent legacy default, and
   “internship” alone does not prove an enrolment requirement. Resolve ambiguous postings.
2. **Role level:** internship/entry/experienced/lead or unspecified, grounded in the approved
   description. This sets the task/rubric, not a hidden age/affiliation multiplier. A mature student
   can have substantial experience and can also be a graduate.
3. **Relevant experience requirements:** job-specific domain/tool/task, explicitly required or
   preferred, optional minimum duration and accepted evidence types. Years of unrelated work
   do not satisfy “two years building production ML systems”. Keep internships, employment,
   research, volunteering and academic/personal projects labelled; only combine as the role allows.

Compute supported durations locally from source-backed role/project intervals. Union overlapping
periods instead of adding simultaneous roles twice; never use years since graduation or account
age. Missing/ambiguous dates produce unknown or a conservative range, not zero or an invented
duration. Tool mention in a five-year role does not establish five years using that tool. Ongoing
roles use an explicit as-of date/version so cached durations refresh on month boundaries; uncertain
full-time/part-time hours remain unknown rather than guessed full-time equivalents.

Score sufficiency for the role, not lifetime tenure: when a job's relevant minimum is met, extra
years add no automatic bonus. For a job without a stated duration requirement, use demonstrated
tasks/depth and do not invent a years threshold. No automatic “overqualified” penalty, maximum-years
exclusion or alumni suppression. Extra experience may provide better evidence of a genuinely
required task, but repeated examples cannot accumulate unlimited points: apply the same bounded
best-evidence allowance per criterion and deduplicate repeated CV/GitHub claims for all members.

An explicitly student-only role filters accordingly before retrieval; an open entry-level role
may match either cohort on its actual criteria. “Show students” is an explicit visible refinement,
not a hidden reranker. Review eligibility restrictions for job relevance and lawful use; do not
substitute graduation-year/age limits for actual enrolment or availability. Education status can
be stale, so describe it as member-declared and provide correction rather than claiming verification
of current enrolment from an old student email alone.

Without a CV, offer an optional, concise member-entered experience/projects editor with provenance
labelled self-reported; do not force an upload or scrape LinkedIn. It uses the same outbound policy,
versioning and consent controls. Missing duration cannot meet a hard minimum automatically: show
separately as “Experience needs confirmation” where possible-match discovery is requested. Do not
fabricate a complete numeric assessment. This editor is A1 scope so optional-CV cohorts have a
practical way to supply comparable evidence.

Evaluation fixtures must mix students, mature students, recent graduates and alumni with/without
CVs. Include a targeted student project versus unrelated decades of experience; matching skill
evidence with cohort label swapped on an open role; overlapping dates; a dated skill inside a long
role; no dates; repeated CV claims; and an experienced role where a qualified alumnus should win.
Measure eligibility errors, within-cohort recall and evidence-source effects. Do not enforce equal
cohort proportions or guarantee students always rank first; enforce job fit and absence of an
unjustified tenure/affiliation bonus.

### 7.2 Posting eligibility and migration — confirmed Students / Graduates / Both

Use `opportunities.eligible_audience` with `students`, `graduates`, `both`. It applies to jobs;
do not add this policy implicitly to events or VC/grants. Both means the union of eligible students
and graduates, deduplicated. A student-only posting excludes graduates who are not also currently
enrolled; a graduate-only posting includes graduates across **all** directory affiliations.

Directory `profiles.role` is insufficient: `staff_faculty`, `mentor` and `angel` do not prove or
disprove degree completion. Current intake omits graduation year for those roles
(`frontend/src/lib/intake/steps.ts`, `NO_GRAD_YEAR`). Add a member-owned education eligibility
record: nullable `currently_enrolled` and `has_completed_degree`, source, confirmed timestamp,
effective dates and version. A current postgraduate can have both facts true. Keep affiliation,
CV requirements and education eligibility separate; do not rename faculty/mentors as alumni.
Record self-declared status honestly. Future institutional verification can strengthen provenance,
but no LLM determines status and passing a forecast graduation date does not prove completion.

Backfill only supported facts with recorded provenance; ask existing members to confirm missing
or stale status. Role/year hints may prefill a confirmation form, not invent a verified fact.
Unknown status does not satisfy a required audience predicate; show a clear profile-completion
route instead of a misleading empty board: one "Confirm your status to see jobs" prompt (F29, owner:
enforce immediately; intake asks the education question so new members are never unknown). Both
accepts either known true fact. Reconfirm enrolment
on a documented periodic schedule and provide immediate correction/graduation updates. These
facts are eligibility predicates, not hidden experience/age score multipliers.

Define one server-side applicant predicate over current approved membership, the approved open
job and confirmed education facts. Use it before retrieval/top-k and again at result/action reads.
Recruiter scope intersects posting audience; a recruiter cannot widen a student-only job to
graduates through chat or a tampered request. Owners/admins retain explicit management access
to their jobs independent of applicant status; this exception must not grant personal Apply access.

Enforce visibility across feeds, direct detail, home newest jobs, bookmarks, activity, directory
open-role indicators, job-skill/sector joins and AI results. Audit table RLS and **every** relevant
SECURITY DEFINER RPC/old overload, since definer functions can bypass table policies. Apply/bookmark
mutations and disclosure of application URLs/contact emails recheck eligibility. Existing Apply
is an external URL/mailto plus activity tracking, not an internal application processor; Foundry
can restrict its own exposure/actions but cannot stop someone applying on an external company
site after obtaining a link elsewhere. Do not advertise a guarantee about external applications.

Community system posts currently copy opportunity titles/descriptions when approved
(`20260829000004_community_system_posts.sql`). Inherit source-job visibility on each post read,
including notifications/search/previews, and invalidate copies when audience/status changes.
An approved-to-approved audience edit must not leave a broadly readable old post. Existing
offsite notifications cannot be recalled; minimise future payloads and re-authorise linked detail.

**Recreating the listing RPCs safely (F21).** This rewrites every listing read RPC, and the project
has twice hit "dead overload" and "return type" traps. For each function: copy the **latest**
migration's signature and return shape exactly; `drop function` first whenever the return table
changes (`create or replace` cannot change it and a changed argument list creates a new overload);
re-apply `revoke … from public, anon, authenticated` plus the intended grants; and after migrating,
run a live grant dump (`aclexplode` over `pg_proc`) because file-based audits miss prod-only
objects and stale overloads.

Migration is expand → review/backfill → enforce, with feature flags and measured query plans:

1. Add education facts, posting audience/version and constraints; permit legacy unknown only
   during transition. Add form validation, RPC argument mapping, row mapper/types, admin creation,
   pending-edit JSON whitelist, edit diff and approval snapshot handling. Approved edits must
   atomically publish the new audience with the new version; drafts never alter live eligibility.
2. Require audience for new jobs; review existing approved jobs before enforcing. Do not silently
   classify all legacy jobs as Both or Students. Unresolved rows enter needs-review and are
   withheld from applicant feeds after cutover, while owners/admins can resolve them.
3. Update all reads/actions above together, test grants and policies, then enforce non-null approved
   audience. Replace `approvedOpportunity()`'s list-and-find lookup (currently capped at 1,000)
   with an authorised ID-specific detail read so larger boards do not produce false missing jobs.
4. Education/audience changes increment versions and invalidate affected feeds, result sets,
   conversation eligibility and caches immediately; fence in-flight publication. Never reuse a
   viewer-independent visibility cache. Keep criterion evidence caches only if independent of
   the changed eligibility and recheck permission. Rollback may disable features, never restore
   unrestricted reads. This document does not apply a migration or mutate live records.

Test every affiliation against true/false/unknown education facts and all three audiences,
postgraduate overlap, member graduation, owner/admin management exceptions, direct SQL/RPC
bypasses, bookmarks/activity/system posts, pending revisions and mid-turn changes. Preserve
events/grants and existing authoring behaviour. Measure filtered indexes/queries at 2k/10k members.

### 7.3 Broad capabilities and individual tools both contribute

Owner clarification: relevance must use both groupings (Deep Learning, Backend Development, etc.)
and specific tools/methods (PyTorch, FastAPI, RAG, etc.). Keep them as separately typed, explainable
criteria in the same rubric; do not discard the broad layer or collapse the specific layer into it.

1. Retrieve from broad categories **and** exact skills/tasks, with recall measured for each. A
   demonstrated specific task can support an appropriate broader capability through a reviewed
   directional evidence rule. A broad category never establishes use of every child technology.
2. Required predicates run before scoring. Deep Learning evidence cannot compensate for missing
   required PyTorch. If the job accepts PyTorch OR TensorFlow, either may meet that group; optional
   exact tools and transferable alternatives remain labelled separately.
3. Within the existing 60% criterion-coverage component, classify weights as specific versus broad.
   Initial tuning default where **both are independently requested**: two-thirds specific,
   one-third broad; distribute within each by the approved requirement rubric. This is a starting
   hypothesis for evals, not a scientifically established universal weighting. A broad-only query
   allocates coverage to broad criteria; do not invent tool requirements. An exact-only query
   allocates coverage to its exact criteria. Network uses its own requested-criterion weights.
4. Deduplicate semantically identical criteria. “PyTorch (Deep Learning)” used only as a category
   label is one need, not two scored requirements. “Deep-learning model development, preferably
   in PyTorch” can express distinct task capability and tool preference. Weight these explicitly;
   adding aliases, more taxonomy ancestors or repeated CV mentions cannot add points. Evidence
   may support distinct facets, but each facet has one bounded contribution, never per-mention gain.
5. Preserve the 25% relevant-task and 15% depth dimensions only where separately defined by the
   rubric, avoiding duplicate points for the same binary tool-presence assertion. Show overall
   evidence-match score plus broad/specific/task contributions, missing requirements and completeness.
   Eligibility and personal preference compatibility are separate statuses, not invisible boosts.

Example coverage-only fixture: for two distinct requested criteria, Deep Learning capability
and preferred PyTorch, allocate the 60 coverage points as 20 broad + 40 specific. Someone with
supported Deep Learning and PyTorch earns 60; supported Deep Learning with TensorFlow-only earns
20 when transferable credit was not requested. The remaining task/depth components are assessed
separately. If PyTorch is required, the latter belongs in a labelled needs-confirmation/alternative
view, never among candidates declared to meet it. If either framework is explicitly accepted,
both can satisfy that requirement. These examples become executable harness fixtures rather than
assuming that arbitrary embedding similarity produces the desired ordering.

## 8. Cache design

Cache evidence assessments, not authorisation or final result lists. Assessment keys include:
`purpose/view, member_id, consent_epoch, projection_hash, atom_semantics_hash,
approved_job_version/context_hash when applicable, rubric_version, policy_version,
schema_version, prompt_version, model_snapshot`.

Atom semantics include kind, operator, canonical value and qualifiers (e.g. duration, leadership,
production use), not just a string. Recruiter dimensions depend on the **effective full job/refinement
context**, not only the original JD hash. Reuse context-free atom judgements only where the rubric
is genuinely independent of the other criteria. Batching may affect model behaviour; evaluate
batch-order independence and key/version any materially contextual assessment.

Every row has an owner-member FK and version; content hashes alone cannot support deletion.
Read/write RPCs require a live authorised turn and the candidate set issued for that turn.
No arbitrary-ID card reads, cross-member cache lookup, or stale “put” after consent withdrawal.
Expiry is 30 days at most, shortened to the earliest private-chat source expiry where applicable
(§5.1); user deletion/withdrawal overrides TTL. Positive and negative results
use the same invalidation rules. HMAC/hash internal keys need not contain plaintext criteria.

Durable single-flight rows have unique keys, lease owner, expiry and monotonically increasing
fencing token. A short transaction atomically claims pending work; the transaction advisory lock
alone does not survive the RPC return. Completion requires the matching fence and current source
versions. Renew leases within a bounded attempt lifetime; never blindly retry at 30s while an
earlier provider call may still be billable. Waiters poll with backoff within their deadline.
Exactly-once external billing across crashes is not guaranteed; §9 accounts for uncertainty.

Query embeddings are cached in Postgres with bounded size/TTL, keyed by purpose, canonical spec
meaning, embedding model/dimensions and policy version. No Redis credential in the AI service.
No externally embedded PII or sensitive/free junk terms. Promotion to global term dictionaries
requires review, so query flooding cannot create an unbounded shared term store.

Chip editing itself is free of model calls, but **running the changed search may not be**:
changing a job, adding a criterion, More-like-this or widening results may discover uncached
candidates. Every execution passes the same spend controls. Removing a criterion can rerank
current results without calls; explicitly label that scope until the user requests new results.
No claim that reopening an unchanged job always costs zero: candidates, policy and evidence change.

Use provider prompt caching opportunistically, with stable prefixes and versioned keys where
supported. Do not pad prompts to 1,024 tokens just to chase a cache hit. Measure cost/latency with
short prompts versus caching; a >=50% hit rate is an observation target, not a security or launch
gate. Policy-approved caching/retention settings must match the chosen model.

### 8.1 Saved recruiter findings and incremental re-scans

Include a private **Matches for this job** workspace in A1, owned by the authorised posting owner.
Saving findings is explicit and distinct from seven-day chat memory. Persist structured criteria,
job/rubric/source versions, run timestamp, coverage status and candidate references with assessed
criterion states; do not copy full CVs, contact information or unbounded model prose. Show last
checked time and **New**, **Updated**, **Needs refresh** labels. Support a bounded saved shortlist
and comparison of evidence against the same job criteria; avoid notes/free-text candidate dossiers
in v1. No sharing/export or organisation-wide access is implied by working at the same company.

**Saved-findings lifetime: seven days, confirmed by owner.** Expire each scan's findings 168 hours
after creation, or immediately on job closure/withdrawal or earlier source expiry. Explicitly saved
search criteria expire no later than their originating chat criteria; saving, viewing, copying or
rescanning cannot reset their expiry. After expiry, ask the recruiter to restate/confirm current
criteria as a fresh source before starting a new scan. New assessments receive their own seven-day
result lifetime, bounded by supporting-source expiry; reused findings keep their original expiry.
No indefinite history of previous scans or automatic renewal on page views. Delete all AI history
also covers these saved workspaces. Candidates' withdrawal, deletion, blocks, loss of eligibility or evidence permission take
effect immediately across saved workspaces; historic scores are not an authorisation exception.

**Check for new matches** runs the same authorised, budgeted pipeline with a frozen approved job
and saved-spec version. New members qualify only once approved, eligible, opted in and their safe
search projection is ready. Existing members who update a CV/GitHub/profile, change education
status or opt in also count as changes; account creation time alone is an inadequate cursor.

Use a transactional change outbox with source/version identifiers, followed by a durable ordered
projection-ready change feed. Cursor ordering must reflect committed ready events (not timestamp
or sequence allocation order that could skip a late commit). Persist scan high-water marks and
processed versions; replay is idempotent. A refresh published after the captured boundary is picked
up next time. Retain deletion/withdrawal tombstones long enough to invalidate all dependent data.
An expired/compacted cursor forces a bounded fresh retrieval, never an incorrect “no changes”.

At scan start, re-authorise saved candidates and remove unavailable ones synchronously. Retrieve
changed eligible candidates plus a fresh baseline of currently relevant candidates; reuse valid
assessments for unchanged evidence. Initial allocation within the existing 200-ID cap: up to 100
changed candidates and 100 baseline candidates, backfill unused slots, deduplicate and protect
exact required skills. Assess at most 20 and publish at most 10 **per run**, preserving the same
global bound. Benchmark allocation/recall; rerank old and new candidates with the same rubric.
Never make newcomers automatically outrank an unchanged better match, or compare scores from
different criteria as if they were the same scale.

Changed-set backlogs use bounded pages and durable coverage records. Advance only over events
actually considered; events not selected for assessment are marked screened, not assessed. Show
“Checked a limited set of eligible profiles” and whether updates remain. No claim to have scanned
the entire directory or found every best candidate. Additional pages require explicit budgeted
execution; no automatic paid fan-out per new member × every job. Preserve an optional refresh of
the baseline so repeated delta runs do not permanently entrench the first shortlist.

If the job/spec/rubric changes, create a new scan generation and invalidate incompatible scores;
reuse only truly context-independent evidence judgements. Changes during a run fence publication
and leave a clear refresh-needed state. No-change checks use indexed version metadata and make
**zero provider calls**, but still consume bounded read/check capacity. Join concurrent same-job,
same-spec, same-snapshot requests into one durable run; client-key changes cannot multiply it.

Initial UX defaults: one active scan/job, a five-minute rescan cooldown and at most ten rescans/job/
rolling day, also inside the member's aggregate quota and monetary ceiling (§9). Counts are tunable
after measurement. Cache hits still consume execution/request capacity; they only avoid provider
cost. Do not auto-run on page open, job selection, every keystroke or each candidate sign-up.
Automatic rescans/email alerts are deferred: enabling them later requires opt-in, per-job budgets,
coalescing, fair scheduling and the same hard controller-wide ceiling.

Apply the same version/deduplication pattern to **Find opportunities**: one member's permitted
profile projection versus approved eligible open jobs; only new/changed jobs and changed profile
evidence need new assessments. Reopening cached recommendations is a re-authorised read, not a
new model call. Neither a saved list nor a cache may keep expired/withdrawn jobs actionable.

## 9. Spend, quotas and durable execution

A **search run** executes criteria against the directory/jobs; a **refinement run** does the same
after changing criteria. A card, connection click or replay of an existing turn is not a search.
Each natural-language attempt may incur one interpreter call even if off-task. Explain this plainly.

Initial tunable defaults: 5 admitted attempts/minute and 40 runs/rolling 24h per approved member;
200 validated draft-chip edits/day; 15 executed turns/thread then explicit continuation from the
current spec; five active threads; 150 distinct members surfaced/viewer/rolling day. Replays have
a separate read rate limit and never duplicate usage/events. Show actual reset time from the ledger.
The 200k-token/member/day ceiling is secondary to money and call caps, and includes failed attempts.
The 5/minute and 40/rolling-day allowance is shared across **all modes**, saved rescans and new
conversations; switching jobs/modes/browser sessions does not reset it. Cap interpreter attempts
as well as successful runs so refused/invalid prompts cannot consume unlimited provider calls.

**Check caps at admission, not after paying (F7).** The 150-distinct-members-surfaced cap and the
per-job rescan caps are checked at admission, before any money is reserved: admission requires the
remaining allowance to be at least the turn's maximum result count. A turn that would exceed it is
refused with its reset time; no paid assessment is ever discarded because a cap was hit afterwards.

**Build on the existing spend layers (F6).** This plan extends, and does not replace, the controls
already in the codebase: `llm_job_budget_available` (30 LLM jobs per member per day) stays the
ingestion per-member gate; job dedupe (`20260908000002`) stays; `githubConnect`/`githubShowcase` stay
on the FAIL_CLOSED bucket list in `ratelimit.ts`. The controller-wide ledger below must also meter
ingestion calls, otherwise the "controller-wide total" is not enforceable. Any new Upstash bucket used
for AI goes on the FAIL_CLOSED list (`ratelimit.test.ts` forces every bucket to be classified), with
Postgres still the authority. A0.1 is concrete: the current client (`openai_client.py:75`) sets no
timeout and leaves SDK retries at the default, and no call sets an output limit; change it to
`OpenAI(timeout=…, max_retries=0)` and set `max_output_tokens` on extraction and summary calls.

Provisional incremental matching budgets: $5/day recruiter, $10/day with network, $15/day with
all modes; these are spending ceilings to validate, not predictions of affordable usage. Reserve
background projection/JD/term work explicitly, and account for ingestion spend separately as well
as in a controller-wide total. A matching project cap does not cap an ingestion project's bill.

**Hard money enforcement is in Postgres.** Provider project alerts are not hard caps. Verify any
available organisation-level hard limit separately; do not assume account access or configure it
as a side effect of development.

For each stage/attempt, atomic admission checks `settled_cost + outstanding_reservations +
new_upper_bound <= daily_cap` and the monthly cap. Use integer microdollars, server-side verified
price versions and pessimistic uncached pricing. Bound input tokens and maximum billed output,
including reasoning where applicable. Round up; reject unrecognised model pricing. Reserve before
embeddings too. Reserve interpretation first, then retrieval-dependent assessment batches; never
pay for the interpreter before reserving its bound. All replicas use the same ledger.

Disable SDK automatic retries (`max_retries=0`) and control one explicit retry within the same
overall turn deadline and a separately reserved attempt. The original “five LLM calls” budget is
five logical calls; a retry means another billable attempt. Cap both logical calls and attempts.
Initial bounds: one interpreter + four assessor logical calls, at most one retry per call,
20s per attempt **within a 45s total turn deadline**; later attempts are not launched if time is
insufficient. Schema truncation cannot trigger an unbounded repair loop.

**Execution order and deadline arithmetic (F3).** Sequential calls cannot fit: 1 interpreter +
4 assessors at 20s each is 100s before any retry. The order is therefore **interpret → retrieve →
up to four assessor batches in parallel**. Worst case without retries: 20s interpreter + ~1s
retrieval + 20s parallel assessment ≈ 41s, inside 45s. A retry is launched only if the remaining
deadline still covers a full 20s attempt timeout; in practice that means at most an interpreter
retry when the first attempt fails fast, and assessor retries only when they fail early. Two
**separate** caps apply: active turns, and in-flight provider requests. Up to 4 requests per turn
means 50 active turns could put 200 requests in flight, so the provider-request cap is its own
setting. Starting ceiling = min(50 active turns, the value derived from measured RPM/TPM headroom).

Settle actual usage per attempt. Failure/cancel does **not** automatically release money: the
provider may already have processed the request. Release only demonstrably unstarted work;
uncertain usage keeps its conservative reservation until reconciliation. A crash reaper finalises
unknown attempts at their upper bound if no authoritative usage arrives. Idempotent settlement
must not double-charge or free a later attempt's reservation. UTC daily buckets are explicit;
cross-midnight running work retains its admission charge plus the monthly guard.

Budget exhaustion is a derived daily availability state, not a write to the operator's `ai_enabled`
kill switch. (**F20:** `ai_enabled` and the per-mode flags do not exist yet; they are new, and follow
the existing `connections_enabled()` pattern, checked inside each RPC.) It resets at the bucket boundary without reopening an operator-disabled feature.
Outages produce “temporarily unavailable”, limits produce “resets at …”. Alert at 80% and on
unreconciled attempts, elevated errors/429s and queue age. Do not promise full 40-run quotas can
be honoured under every global daily cap.

Turn state: queued → running → completed/partial/failed/cancelled; attempts and checkpoints are
durable. A runner independent of the browser owns work, with a bounded lease and shutdown drain.
Only store minimised specs/payloads. Closing a tab stops polling, not the ledger. Explicit
Stop prevents undispatched calls and best-effort cancels dispatched work without promising no charge.
Restart resumes only safely unstarted work; unknown provider requests are not blindly resent.
Use bounded queue admission, shared org/model TPM/RPM allocation with ingestion, replica-local
semaphores and a global ceiling. Five replicas × eight calls is not itself a shared rate limit.

**Job runners (F31).** Follow the project pattern: pg_cron (already used by 10 migrations) runs the
DB-only work (hourly purge, seven-day expiry, spend reconciliation and the unknown-attempt reaper's
settlement), so it keeps working when ACA is down. The executor reaps its own expired leases on
claim. Each cron checks in with Sentry (programme Part G3) so a stopped job alerts.

**Throughput is limited by spend, not compute (F5).** The $5/$10/$15 daily caps (and the spec's
"low search volume") allow tens to low hundreds of turns a day. Derive the expected turns/day from
the measured cost per turn, and size compute to that, not to 50 concurrent turns. Load tests use a
test-only ledger cap so they can exercise admission without real spend.

**Capacity recommendation:** design for 500 site users and a burst of 500 AI submissions to be
handled safely, but do not promise 500 simultaneous model generations at launch. Start with a
measured cap of min(50, RPM/TPM-derived) active AI turns (F3), then raise it in staging (F33 meaning; for example 50 → 100 → 200 → 500)
only while provider quotas, end-to-end latency, DB pool/CPU, queue age, error rate and hard spend
ceilings remain within their gates. The durable queue absorbs short bursts, not sustained excess
demand: admission must reject before any provider call once the bounded backlog or oldest-wait
limit is reached, preserve the user's draft and give a retry estimate. Set backlog capacity and
queue-wait SLO from observed turn duration and acceptable UX; a 500-item queue that routinely
misses the useful-response deadline is not successful capacity. Start the 45-second provider-turn
deadline when a worker claims a turn, and give queue wait its own explicit maximum and expiry.

The send action creates an owner/conversation-scoped idempotency key once and reuses it for network
retries; a database uniqueness constraint makes simultaneous double-clicks, browser retries and
replica races resolve to one turn/reservation. A deliberate new search gets a new key only after
the client has a new user action. Button disabling and debounce improve UX but are not security or
cost controls. Return `202` with the durable turn ID after admission. The client **polls** for
safe lifecycle/progress state (one request in flight, conditional revision/ETag reads, backoff with
jitter of about 1s → 2s → 4s capped, paused on hidden tabs; F2), then fetches the authorized
persisted result. No event stream in v1. Do not stream raw model tokens, candidate data or partial
scores to the browser: publish results atomically only after structured-output validation, current
eligibility/consent checks, evidence validation and scoring. Queue wait is distinct from execution;
reconnects and cancellation never create a new paid attempt. Test 500 simultaneous submission and
idempotency races across multiple app/worker replicas, while enforcing a much smaller measured
provider-active ceiling.

### 9.1 Endpoint abuse and fairness controls

Current `frontend/src/lib/ratelimit.ts:266–293,393–415` deliberately uses a weaker per-instance
fallback for some buckets during Redis outages and allows requests when Redis is unconfigured.
That existing behaviour is **not an adequate distributed spending boundary for AI**. Keep the
authoritative atomic admission/quota/money checks in Postgres for every paid path, including
direct service calls and background jobs. If the authoritative ledger/limits cannot be checked,
launch no provider work; return a distinct temporary-unavailable response. Local fallback may
protect basic reads but cannot authorise paid work. Startup must refuse paid mode with missing
budget configuration, prices or enforcement dependencies, including accidental local/CI settings.

Admission ordering: cheap body/format limits → authentication/current approval → account and
trusted-edge abuse gates → atomic quota/concurrency/idempotency/budget reservation → provider.
No model-based intent classifier or moderation before paid admission and local privacy policy.
Malformed, unauthenticated, oversize and already-limited traffic must cause zero provider calls.
Count denied traffic in a separate bounded abuse bucket; do not let it create unlimited turns,
ledger rows or high-cardinality metrics/logs. Avoid arbitrary unbounded idempotency keys or cache
keys from attackers: length/shape limits, owner scoping, TTLs and storage quotas apply.

Define an explicit registry for every route/server action/RPC/job: identity scope, request limit,
concurrency, input/output bound, timeout, provider-call bound, idempotency and failure policy.
Admission tests fail if a new payable path has no policy. A model wrapper requires an admitted
attempt/reservation; the transport spy rejects any provider call without one. Isolate production
egress to approved wrappers and verify no unmetered SDK/client escapes through ingestion helpers.

Initial secondary limits: result/status/history reads 60/minute/member, at most one in-flight
status poll per turn per tab (F2), rescan-check metadata 12/minute/member, draft operations 30/minute/member plus §9's daily
cap. Coalesce polling, use backoff and conditional version reads; apply shared server limits to
reconnects/cancel/save/forget endpoints too without preventing a member's privacy deletion request.
Give deletion an idempotent reserved control path and bounded worker queue. Enforce IP/edge burst
limits as an additional abuse signal, not identity: campus NATs share IPs and proxy headers can be
spoofed outside trusted ingress. Stop/detach must not create duplicate billed retries.

Account approval and per-member quotas reduce abuse but do not eliminate multi-account attacks.
Controller-wide daily/monthly ceilings are the final financial backstop. Use per-member monetary
reservations and per-mode/background allocations inside that ceiling so one costly input, many
jobs or SLM work cannot consume everyone's capacity. Allocate fairly with bounded per-member
queues; do not expose cross-user usage. Set per-member dollar allowances from measured turn costs
before rollout, never assume 40 worst-case runs fit the shared $5 cap. Alert on sustained denial,
distinct-spec/cache churn, abnormal account cohorts and budget burn using minimised telemetry.
Cached reads can remain available during spend exhaustion only with live permission checks and
bounded DB capacity. Recovery from an outage must not flush an unbounded backlog of paid work.

## 10. Service, database and HTTP security

Keep the AI runtime isolated from the upload gateway and ingestion worker. Azure Container Apps
is the planned target; slim dedicated image, no Blob/GitHub credentials, service-role key or broad
worker DSN. Use a dedicated identity only for narrowly scoped Key Vault/registry access if needed;
it receives no Blob, GitHub, VM or broad subscription data permissions. Separate `AiSettings`, async
OpenAI client and small DB pool. Restrict network egress where supported; never fetch model-supplied
URLs. Inspect actual deployed identity/metadata reachability; an IMDS probe alone is not complete
isolation evidence.

**Authority model for the no-ingress executor (F1, replaces the earlier opaque-capability flow).**
The preferred ACA executor has no ingress and claims work from a Postgres queue, so it never
receives a per-request token; a 60-second capability would also expire while its turn waits in the
queue. The turn row itself is the authority:

1. The browser calls a same-origin Vercel route. Next.js validates the logged-in approved member
   through the existing auth/rate-limit patterns, then calls a **user-session** RPC (running as the
   member, so actor = `auth.uid()`). That RPC admits the turn atomically: approval, mode/job
   eligibility, expected spec version, body size, quotas, idempotency and money reservation; then it
   inserts the queued turn row with the actor, mode, conversation, job/version and canonical body
   digest. Nothing the executor later receives can change who the turn is for.
2. The executor calls `ai_claim_turn()`, which returns one queued turn plus a **lease token and
   fencing number**. Leases expire; a stale holder's writes are rejected by the fencing check.
3. Every service RPC takes `(turn_id, lease_token)`, derives the actor and scope from the turn
   row (never from a caller-supplied member ID), rechecks eligibility, clamps limits and validates
   candidate IDs against the turn's issued retrieval set. The AI role cannot create turns or mint
   an identity.
4. Identical client retries hit the idempotency constraint and receive the existing turn;
   conflicting reuse returns 409. Turn IDs never appear in analytics payloads (F19).

Opaque request capabilities are kept only as the design to use **if HTTP ingress is ever added**
(below); they are not part of v1. This limits runtime compromise to claimed turns and their data
rather than permitting arbitrary member impersonation. It does not make a compromised process harmless or stop theft of its own
OpenAI key; provider key restrictions, network isolation and detection remain necessary.

The `ai_service` login is NOINHERIT/NOBYPASSRLS with no application-table access, no object
ownership, no schema CREATE and only enumerated RPC EXECUTE grants. Function owners are separate
non-login roles with minimal privileges. SECURITY DEFINER functions pin a safe search_path,
qualify relations and never execute generated SQL. Audit PUBLIC/default grants, inherited roles
and existing functions too; revoking only the new functions is insufficient. User tables have RLS
and owner-scoped RPCs; direct reads cannot bypass replay privacy checks. Return safe projections.
Do not grant service-role access as a pooler fallback. Validate restricted login/transaction pooling
in a local/staging proof before relying on it; if unsupported use an equivalently scoped gateway.

**Where the executor's functions live (F17).** On Supabase, `anon` and `authenticated` get EXECUTE
on every new function in `public` through default privileges, whatever `ai_service` is granted,
and `revoke … from public` alone does not remove it (proven live; migration `20260608000001`). The
executor connects directly to Postgres as `ai_service` (like the existing worker, `server/app/db.py`),
so its RPCs live in a schema PostgREST does **not** expose, `ai_private`, and browsers cannot reach
them at all. Defence in depth: `revoke execute … from public, anon, authenticated` on each, plus an
in-body `current_user` role guard. Negative tests use `has_function_privilege` (local CLI 2.116
segfaults on call-and-catch of a denied SECURITY DEFINER function).

**Background work stays with the existing CV worker (F26, owner).** The CV worker builds
`member_search_docs`, JD requirements and their embeddings, under the scoped `cv_worker` role below
and metered by the same ledger. The ACA executor runs turns and query embeddings only and never
reads raw CV/GitHub sources.

**Now, independent of AI: scope the existing worker's login (F25, with B13).** Today the CV worker
connects as the `postgres` role through the session pooler (`server/README.md:69`,
`infra/vm/bootstrap-worker.sh:105-116`), so it can read and write every table including
`auth.users`, and its DSN sets no `sslmode`. Its real footprint is small: `jobs`, `cvs`,
`cv_profiles`, `cv_chunks`, `cv_skills` (read), `member_skills`, `github_connections`, plus
`update_cv_currency()` and `pgp_sym_decrypt`. Create a `cv_worker` login (NOINHERIT, NOBYPASSRLS)
granted only those tables/columns and functions, with `to cv_worker` RLS policies on them; use the
same role locally so worker tests fail on a missing grant; verify the session pooler accepts the
custom role first; DSN uses `sslmode=require`. Owner steps: set the password and switch
`/etc/foundry/worker.env`, keeping the old DSN for rollback. Update `server/README.md` and
`bootstrap-worker.sh`. The F26 projection jobs extend this role's grants explicitly. This is built
at the start of the AI phase, before A0.

Browser-facing HTTP stays same-origin on Vercel: bounded authenticated submit/refine/cancel routes
and status/result reads. `POST` persists a durable turn and returns `202 Accepted` quickly; the
browser never calls ACA or holds a request open for model inference. Status is polled with the
jitter/backoff policy in §10.1; there is no status stream in v1 (F2).
Bodies are capped at 4 KiB and messages at 600 Unicode characters plus a token limit; JD parsing
uses a separately bounded input. Keep private responses `no-store`, validate origin/CSRF as
appropriate to the existing session model, and use same-origin CSP. Errors and throttling have
typed status codes and a visible retry time. All repeated mutations require idempotency.

The preferred ACA executor has **no public ingress**: it claims work through a restricted durable
queue/RPC and can only call the database's named functions and the approved OpenAI API. Keep its
health/readiness path internal to Azure monitoring. This removes an externally reachable AI origin
and avoids a second public route to secure. If implementation later requires an HTTP endpoint,
introduce it only as a reviewed architecture change: private/internal ingress where Vercel can
reach it, or validated mutual TLS/rotated edge-origin authentication with host/default-route denial;
never rely on ACA's hostname being obscure, source-IP allowlisting alone, or CORS as authentication.
Any browser-visible API secret is prohibited. Test egress routes, database TLS/connection pooling,
secret access and direct-origin bypass. Health reports readiness without disclosing configuration.
Test replica drain, safe queue lease handoff, rolling revisions, schema-compatible rollback and
restore of the prior immutable image.

### 10.1 Deployment, latency and capacity strategy

The existing app is hosted on Vercel with Supabase Postgres/Auth/Data API; the image gateway and
CV/GitHub ingestion worker already occupy separate Azure VMs. The current runbook describes each
VM as 2 vCPU / 8 GB and the gateway as two CPU-bound Gunicorn workers; the worker shares its host
with ingestion jobs and holds OpenAI/GitHub/database access. A separate AI workload must not be
added to the worker merely to avoid another compute bill: hostile CV/GitHub content, model calls,
worker load and credentials would share a host. Nor should a third user-managed VM be the default.

**Recommended topology for the first release:** keep Next.js on Vercel; use short server-side
Vercel handlers as the authenticated browser boundary; persist a bounded turn/attempt in Postgres
and return `202 Accepted` promptly; run the isolated AI executor in Azure Container Apps (ACA),
which is managed container compute rather than a third VM to patch. ACA claims durable work, calls
only the approved model and restricted database RPCs, then publishes versioned results. The browser
reads status/results through the authenticated Vercel boundary. This makes browser disconnects
recoverable and means a user does not wait for a model call inside a Vercel page render. If the
chosen design instead exposes an ACA HTTP endpoint, add the origin authentication and the opaque
capability fallback described in §10; a public hostname plus CORS is not protection.

**What "staging" means here (F33, owner 2026-09-28).** No staging project exists. Before launch,
"staging" in this plan means local/ephemeral runs for correctness and the fake-provider 500-burst,
plus the programme's pre-launch prod test window (Part E3) for hosted capacity. After launch, any
capacity-affecting change, including raising the concurrency ceiling, needs a staging project first.

| Option | Benefits | Cost/risk | Plan position |
|---|---|---|---|
| ACA with warm replicas | Separate image, identity, scale limits, revisions and resource pool; no host patching; scales beyond one VM. Keeping minimum replicas above zero avoids scale-to-zero startup on the normal path. | Additional managed-compute, ingress/logging and always-warm replica spend; scale-out replicas still need to start; region/quota/network configuration and origin security add operational work. | **Preferred**, subject to a small deployment spike and cost/latency test. Never configure the user-facing executor to scale to zero at launch. **Start with one warm replica (F5):** the durable queue turns a replica restart into a delay, not lost work, and launch throughput is spend-limited. Move to two only when measured SLO/availability justifies it; verify UK South ACA zone support first. Add the idle replica cost to the Economics gate. |
| AI process/container on gateway VM | No new VM and little new platform setup. | Shares a 2-vCPU host with the public upload gateway, competes with image decoding, creates a common failure/patch domain, constrains horizontal scale and complicates isolation from the gateway's storage identity and secrets. | Do not choose for launch. At most use as a disposable benchmark/control experiment after IMDS, network, cgroup and secret isolation are proven. |
| AI process/container on ingestion VM | No new VM. | Shares CPU/DB/provider queues and the host that reads untrusted CV/GitHub material and holds ingestion secrets; adds HTTP exposure to a machine deliberately deployed with no inbound listener. | Reject for the launch architecture. |
| All AI execution in Vercel Functions | No separately operated compute service; elastic function concurrency; closest integration with Next.js auth and UI. | Plan/runtime, region, duration, streaming, per-invocation cost, cancellation and durable-work semantics must be verified. A function's high concurrency does not raise Postgres/OpenAI capacity or provide a durable queue. Platform throttling can surface as 503; serverless instances are not a shared in-memory limiter. | Keep Vercel as the short-lived BFF/status layer. Reconsider a full Vercel executor only if a prototype passes the same 500-user, durability, cost, privacy and cold/scale tests with the actual plan configuration. |

ACA warm-up decision: **do not rely on scale-from-zero for an interactive product.** Azure documents that `minReplicas >= 1` keeps an instance running; zone-redundant ACA requires at least two minimum replicas to spread across zones, which is a later step, not the launch floor (F5). Always-ready replicas have an idle charge, which is the direct tradeoff for reliable first-turn latency. Set a tested nonzero floor, use a measured HTTP concurrency rule for any API replicas and a bounded queue/workload metric for the executor, cap maximum replicas by DB/provider budgets, and ensure a warm floor can absorb normal traffic while scale-out occurs. A 500-request burst must receive a fast accepted/queued or clear capacity response; it must not trigger 500 simultaneous model calls. Do not let platform autoscaling override the global provider semaphore, per-user limits or money reservations. Confirm current regional support, quota, ingress type, SKU/workload profile and price before provisioning; capacity on paper is not reserved capacity.

Use a durable Postgres turn queue as source of truth, with row leases/fencing already specified in §§8–9. Start with a small, fixed executor pool on warm ACA replicas; derive the maximum active assessment batches from measured DB headroom, model RPM/TPM and spend ceilings. Scale worker replicas from a supported backlog/age signal only after verifying the scaler and its polling delay; if a reliable scaler is unavailable, keep a conservative fixed pool and bounded queue rather than adding a new queue technology prematurely. Queue capacity, oldest-item age and per-member fairness are explicit product/service limits. When full, reject before any provider call with a retry time and preserve the user's draft. Worker scale-in drains leases and does not interrupt or duplicate a possibly billable attempt.

**Read latency and load:** Vercel's CDN should serve static assets and genuinely public/static pages. Authenticated member, connection, bookmark, profile and AI results remain private/no-store unless a cache has a proven viewer/purpose/version key and a live authorisation check. Preserve the nonce CSP and dynamic rendering; do not make sensitive pages publicly cacheable to improve a benchmark. Keep shared, low-change facets in a short bounded cache; keep search results paged and SQL-filtered; avoid fetching full directories and fan-out RPCs per visible card. Batch connection state and result hydration. Cache misses should have timeouts and coalescing so a Redis outage does not become an unbounded Postgres stampede; shared Upstash cache/rate-limit configuration and command quota must be verified.

**Earlier audits disagree for known reasons (F9).** C2 (2026-09-08) found 0% errors at 500 VUs, rendering-bound, with the knee between 250 and 500; C5 measured the per-page DB work; C6 found 84.79% failures. Both C2 and C6 ran locally, and C6 was authenticated with only 20 reused identities, so their results measure different things. The owner's 50/100 result is explained by `scalability-audit.md` §3: a Free-sized database holds about 50 active members and fails at 100, while two full cores held 250 at p95 < 0.43 s. Launch compute is now Supabase Pro on **Medium** (owner, 2026-09-28), and the programme's E1b gates (250, then 500) replace ad-hoc comparisons.

**Current load signal and paid-tier validation:** the owner reports that a k6 run passed at 50 concurrent users and failed at 100, but has not supplied the environment, build, test script/configuration, request mix, pass thresholds or error/latency traces. Preserve those artifacts before changing settings and reproduce the 50/100 ramp in an isolated production-like staging environment. Attribute failures by browser/auth redirects, Vercel function saturation/region, Supabase Auth/PostgREST/database CPU and memory, pool waits, query plans, cache, and network/socket errors before resizing. The intended capacity is **500 concurrent authenticated site users with approximately 2,000 total members**, with a separate 1,000-VU headroom/recovery run; registered members are not equivalent to simultaneous active sessions. This site SLO does not promise 500 simultaneous OpenAI generations: the starting AI service objective is up to 50 active turns (10% of site users), while a 500-submit burst must be admitted/rejected safely and queued within explicit limits. If product expects 500 simultaneous AI turns, model/provider quotas, queue wait SLO, cost ceiling and worker sizing require a separate higher-capacity design and explicit budget. Test realistic unique identities against a 2,000-member directory corpus (and a 10,000-member growth corpus), read/write/polling mix, bursts, login/auth separately, and the AI queue/provider budget independently. Upgrade the staging Supabase project to Pro, then explicitly select and verify database compute sized from measurements—Pro's included compute credit can cover Micro, but that does not imply enough CPU/RAM for this workload. Resend Pro is for staged mail-volume/deliverability testing; it does not raise database or page capacity. Keep email asynchronous behind the existing outbox, then separately test provider quotas, queue lag, retries, webhook idempotency and bounce/suppression handling. Promote tiers/configuration only after equivalent runs show the bottleneck is resolved and the 500-user gates below pass; don't change multiple capacity variables at once.

**The region question is answered in the repo, and the auth path has avoidable round trips (F8).** Functions are pinned to `fra1` in `frontend/vercel.json` (also recorded in compliance docs 01/03), and Supabase is in London. Every authenticated page calls `getUser()` in the proxy (`lib/supabase/proxy.ts:52`), again in the guard (`lib/auth/guard.ts:92`), then `is_admin` and the profile read: at least three sequential Frankfurt↔London round trips before any page data. A0 runs this as a measured before/after experiment: (a) fra1 vs lhr1 in the pre-launch prod window; a move means editing `vercel.json`, compliance docs 01/03 and any location copy; (b) `getClaims()` in the guard (local JWT verification with asymmetric signing keys; the status check stays in the DB); (c) one cached per-request Auth/profile lookup. Items (b) and (c) are built in the programme's Part B (B26) before AI work starts.

Locate each database-bound compute hop near the database. The repository's compliance notes identify Supabase as EU West 2/London while the Vercel processor record names Frankfurt; C6 says actual project/function settings still need live verification. Confirm the actual Supabase region and Vercel Function region, measure RTT and page-query breakdown, then use Vercel London (`lhr1`) for database-bound functions and ACA UK South when supported/approved. Keep static CDN delivery global. Region changes must be reviewed against transfer/location commitments; do not trade legal accuracy for a benchmark. Include OpenAI request latency/region and network egress in measurements.

Instrument a page read as browser → Vercel edge/function → Auth → PostgREST/Postgres → optional cache, and a write as browser → authenticated server action → validation/admission → database transaction/outbox → async provider. Record p50/p95/p99 by stage, errors/redirects, timeouts/socket resets, SQL duration/rows, pool wait, cache hit/miss/timeout, function region/cold starts, queue age, worker saturation and provider RPM/TPM/cost. A failed read must display a retryable error; never let a swallowed RPC failure masquerade as a successful empty page. For writes, use idempotency and database constraints for retries; keep mail/model/embedding work outside the transaction and make status visible. Preserve optimistic UI only when it can roll back accurately.

**Development latency audits:** establish a repeatable baseline before AI work changes existing pages, then run focused audits during each implementation phase and before release or a concurrency increase. Measure browser experience (Core Web Vitals including LCP/INP/CLS), route/server render, Auth, PostgREST/SQL, cache, worker queue wait, each provider stage, evidence scoring, result persistence and first useful result separately. Record p50/p95/p99 and errors for cold/warm, cache hit/miss, typical and sparse profiles, 2k/10k directory corpus, mobile/network-throttled browser and the 50→100→500 load ramps. Distinguish controlled lab/browser tests from privacy-approved aggregate real-user performance measurements; do not add an unapproved analytics processor just to collect Web Vitals. Use query plans and sampled traces to find regressions; fix N+1 reads, repeated auth/permission lookups, oversized payloads, unbounded hydration, pool contention, polling and avoidable model calls where evidence identifies them. Re-run the same scenario after each material optimization so gains and regressions are attributable. Do not log prompts, CV text, candidate identifiers or secrets in traces; use short-lived opaque trace IDs and bounded labels. Existing §14 latency numbers are provisional acceptance targets to validate with product expectations and staging measurements, not promises inferred from local runs.

**Production concurrency monitoring and change control:** provide an operator dashboard and alert/runbook for the active-turn ceiling; do not auto-raise it from queue depth. Track, at minimum, the configured and observed active turns; queue depth, oldest-item age, and enqueue-to-start p50/p95/p99; accepted/queued/rejected/idempotent-replay counts and bounded rejection reasons; turn completion/partial/failure/cancel rates; provider request latency, 429/5xx/timeouts/retries, and observed RPM/TPM headroom; ACA replica/worker CPU, memory, lease age and drain; Supabase DB CPU/memory, active/pooler connections and pool wait/query latency; status-poll volume; and reserved/settled/unreconciled spend plus projected daily/monthly cap use. Break down only by bounded dimensions (mode, model/deployment version, outcome, region); do not attach member/job IDs, prompt text, CV content, emails or other personal data to metrics or general logs. Use opaque trace IDs with short retention for cross-service diagnosis.

The application admin surface must make aggregate AI availability/capacity understandable without requiring access to infrastructure consoles: current configured and observed concurrency, queued/running counts, queue-age and result-latency percentiles, accepted/rejected volume, dependency health, provider throttling, DB/worker pressure, spend against hard caps, recent incidents and the last concurrency changes with timestamp/reason/actor. Separate general community-administrator read-only health/usage from a narrowly assigned AI-operator capability that can change the ceiling or invoke the AI kill switch. Changes require reason, audit record and confirmation; expose only bounded operational aggregates, never raw messages, CV evidence, candidate lists, keys or per-member spend. Admin page access and change APIs must use server-side role checks/RLS or a restricted RPC, be rate-limited, and have access itself audited. If the dashboard is unavailable, authoritative limits still apply and AI service continues safely; dashboard/control failure must never fail open.

Keep the active ceiling as an operator-controlled, versioned setting enforced by the shared server-side admission/semaphore authority across all replicas; a per-process environment variable or autoscaler limit is not sufficient. Bound operator-configurable values by a hard maximum proven in staging and allowed by provider quotas; raising that maximum requires a new capacity/cost review. Restrict changes to authorized operators, audit them, require a recorded reason, and preserve the last known-good value for rollback. Before launch, agree an enqueue-to-start p95 SLO, hard maximum queue age, and overload/rejection SLO from usability and staging evidence. Page on oldest queue age beyond its service limit, sustained admission rejections, provider throttling/timeouts, worker/DB pool pressure, result errors, or spend nearing the hard cap; alert separately at the existing 80% budget threshold. Set exact alert thresholds from staging baselines and provider quotas. A concurrency increase is considered only when the active ceiling is persistently saturated and queue-start latency or congestion rejections breach their SLO during representative demand; then verify provider RPM/TPM (including ingestion's shared usage), database, worker, end-to-end latency and spend headroom are all healthy with reserve. A queue alarm alone is not a raise signal. If pressure is due to a dependency or spend limit, keep the ceiling and fix the constraint or communicate a clear wait/retry state. Otherwise raise the setting in a small staged increment (initially no more than 20–25%), canary/load-test it, observe at least one representative peak window, and retain an immediate rollback path. Name the operational owner for each alert, destination, response target and escalation path before launch; alerts without a responding owner are not operational monitoring. Do not relax per-member quotas, daily money caps, privacy checks or tool budgets as a side effect of raising global concurrency. Record the before/after queue, latency, error, saturation and cost evidence in the runbook; if any gate regresses, restore the prior ceiling and investigate before another increase.

Poll AI job status with one in-flight request, conditional revisions, jitter and increasing intervals while idle; stop polling on hidden tabs and resume with a fresh status check. Reuse the same policy for CV/GitHub progress dialogs: current audit notes their two-second timers can overlap, producing about 250 status requests/second if 500 dialogs stay visible. **v1 uses polling only (F2).** On Vercel, an SSE stream keeps a billed function open for the whole turn and still has to poll Postgres, and Supabase Realtime is not used anywhere in the frontend. Suggested backoff: about 1s → 2s → 4s with jitter, capped, one request in flight, conditional revision reads. Prove it under 500 sessions.

**Deployment pipeline:** build one immutable image by digest; scan dependencies/image and produce an SBOM; publish through CI OIDC with environment-scoped permissions; store only the AI OpenAI key and restricted DB capability in Key Vault/ACA secrets; use a dedicated least-privilege identity for secret/image access only, with no Blob/GitHub permissions. Deploy to staging first, run schema-compatible migrations before traffic, smoke-test health/readiness and representative authorised paths, then shift ACA revision traffic gradually. Preserve the previous image/revision and use feature flags for rapid disable; database rollback must be additive/compatible. Set startup/readiness/liveness probes, graceful drain, safe max surge and alerts for cold-start/queue age, error rate, p95/p99, replica count, DB pressure, provider spend and security denials. Recheck secrets, role assignments, ingress/origin bypass, SBOM/CVEs, audit logs, backup restore and incident/rollback procedure before enabling a mode. No resource provisioning or deployment occurs as part of this plan revision.

## 11. Persistence and rights

Normalised tables: discovery preferences/consent audit; versioned search docs and evidence;
approved `opportunity_requirements` and audience versions; member education eligibility;
conversations/spec versions; source messages with expiry; scoped memory items/clusters and
source-dependency edges; turns/attempts; result rows;
assessments/leases (lease token + fencing number, §10); trace spans (metadata only, §14 G9 note);
usage reservations/settlements; optional user-owned shortlists. (Opaque capabilities are only the
ingress fallback, F1.)

**Deletion must keep working (F30).** `delete_my_account` and the admin delete RPCs delete rows in a
fixed order (`20260529000004_delete_my_account_full_cleanup.sql`,
`20260529000007_admin_delete_user_rpcs.sql`, `20260917000009_…`), and some FKs are `ON DELETE
RESTRICT`. Every new AI table uses `ON DELETE CASCADE` from its member/opportunity FKs, or is added
explicitly to every delete RPC. Tests prove self-delete, admin delete, job delete and graduate
delete all succeed with AI rows present.
Saved job searches/scans and their candidate references follow the same seven-day ceiling (§8.1),
with real owner/job/member FKs, scan generation, source expiry and bounded coverage cursors.
All member/posting references use real FKs. Result row CHECK requires exactly one target type;
composite ownership checks prevent attaching someone else's turn/conversation. No hidden target
UUIDs in JSON that deletion cannot reach. Result/evidence bindings include evaluated versions.

Current eligible cards are hydrated through a user-session `ai_result_cards(turn_id)` RPC; no
arbitrary ID service lookup. Names/avatars/contact actions remain on that side of the boundary.
Historical results with changed source versions are marked stale and cannot attach today's
evidence to yesterday's score. Withdrawal/bans/blocks suppress them rather than just their quotes.

Seven-day expiry applies to messages and their derived chat state (§5.1); read-time checks precede
asynchronous physical purge. Delete conversation cascades its source history, graph derivatives,
turns/results/shortlists tied solely to that conversation, including dependencies in other chats.
Assessment
cache and minimal financial audit retention have separately documented purposes and durations;
deletion is not a quota reset. Delete account cascades subject-linked features/caches/results;
retain only lawful, minimised billing totals as defined in the retention schedule. Consent audit
keeps version/time/purpose as needed to demonstrate prior processing; no indefinite raw prompts.

No admin conversation browser. Abuse investigation uses a documented, audited access procedure
that logs before access. DSAR scope includes the subject's source/derived data, profiling/evidence,
own conversations and relevant recommendation activity, while protecting other users' rights.
Do not promise automatic disclosure of recruiters' confidential text or blanket withholding.

## 12. UI/UX implementation brief

Operate mode, using the current Archivo typography, near-black surfaces, white action buttons,
existing AppShell and accessible border/focus tokens. No new branding exercise is needed.

**Where it lives (F11).** The feature takes over the existing `/foundry-ai` page
(`frontend/src/app/foundry-ai/page.tsx`, sidebar entry in `Sidebar.tsx`). While every AI flag is
off, the page keeps its current "Coming soon" placeholder; it becomes the AI page when the modes
ship.

**Copy rule (F22, owner preference).** Every explanation is one sentence plus a link to
`/ai-notice`; the detail lives on that page, not inline. This applies to the first-use explanation,
the disclaimer, source/expiry notes and the privacy controls below.

**Controls need a visible shape (F23).** Chips, the mode selector, Required/Preferred toggles and the
rail are new controls; each gets a visible border (`--color-border-strong`), never bare text.
Checked in the §14.4 visual pass rather than by a brittle CSS assertion.

**Loading states** reuse the programme's shared components (`Skeleton`, `Button loading`, toasts,
navigation progress; programme Part C5).

The interface is a primary product deliverable, not a thin shell around the matching API. Prioritise
clarity, confidence, control and low effort over exposing every capability at once. Before coding,
turn these requirements into a clickable flow for each mode and run task-based usability sessions
with representative students, graduates, recruiters and members with no CV/GitHub evidence. Test
whether people can start, refine, understand, correct and leave a match flow without coaching. Keep
the mode-specific scope, actions and copy consistent with the consent/eligibility contract.

- **Make the first useful action obvious.** Show a short plain-language explanation of what the
  selected mode can do and what sources it may use. Provide editable example starters, such as
  “Find a Deep Learning collaborator who enjoys chess”, a role-specific candidate search, and a
  job search with preferences. Examples are prompts, not default consent or criteria. Include a
  useful manual-search path when AI is unavailable or the member declines discovery.
- **Meet people in their existing workflow.** Add contextual entry points from the directory and
  opportunities pages. “Build your network” can start from the member's existing directory query
  and filters; “Find opportunities” can carry current job filters into a visible draft. Show exactly
  what was carried over, keep the original page state recoverable, and require confirmation before
  an AI request. Returning from the assistant restores the user's place and does not mutate filters
  or send a connection/application action.
- **Use progressive disclosure.** Keep the current mode, job and a concise criteria summary visible;
  put detailed evidence, score components and data controls behind deliberate expansion. Provide
  visible edit/remove/undo controls rather than requiring users to know prompt syntax. Clearly
  distinguish “must have”, “nice to have”, “either/or”, personal preference and unresolved criteria.
- **Keep conversational control.** A new turn previews its effect on the active criteria before a
  paid search when it changes meaning, audience, required status or scope. Simple additions can be
  shown as a reversible update. Preserve the previous completed results while work runs; label them
  as previous results, then replace the set atomically. Users can edit, cancel, retry safely and
  return to a prior turn without accidental duplicate spend. Switching mode starts or resumes the
  correct isolated thread and never silently carries criteria across modes.
- **Make results explainable and actionable.** Each result answers “why this one”, “what is missing
  or uncertain”, “how current is this evidence”, and “what can I do next?” in a compact card. Show
  criterion-level support and conflicts; separate evidence fit, mandatory qualification,
  eligibility, preferences and confidence/completeness. Do not show a single unqualified number
  where it could be read as a probability. Evidence quotes are optional, consented and source-bound.
- **Design failure states as part of the journey.** Distinguish no eligible matches, no evidence,
  incomplete/stale source data, criteria too narrow, clarification needed, budget exhausted, queue
  busy, outage and partial scan. Say what happened, what remains unchanged, when a limit resets and
  the next safe action. Offer broaden/edit controls without silently relaxing hard requirements.
  Keep ordinary directory/job browsing usable during AI outages and quota exhaustion.
- **Treat privacy controls as usable product controls.** Before first use, explain purpose and data
  source in plain terms. Give separate controls for discovery participation and evidence sharing,
  show their current state and effect, and make withdrawal/deletion easy to find. Do not make
  consent a condition for unrelated core membership. Explain source freshness and the seven-day
  chat/findings lifetime at the point of use, not only in legal copy.
- **Refine incumbent interactions while adding AI.** Preserve the directory's URL-backed filters,
  result count and paging. Make long skill/sector facets searchable or collapsible instead of
  presenting an unbounded chip wall. Replace clickable `div role=button` cards with a clear semantic
  pattern that permits nested links/actions; activating Apply, Connect or a profile link must never
  also collapse/expand the card. Give the searchable multi-select a complete combobox/listbox
  keyboard model or use a native checkbox group, with screen-reader state and focus management.
  Keep search placeholder claims aligned with fields actually searched. In the profile dialog, show
  a recoverable load error with Retry when full details fail; preserve focus, scroll and the usable
  preview. Set practical touch targets (aim for 44×44 CSS px for primary mobile controls) and test
  zoom/reflow. These are scoped usability fixes from source review, not a redesign of the site's
  visual identity.
- **Measure usability, not just visual polish.** In formative sessions, record task completion,
  unassisted completion, time to first useful result, misunderstood score/eligibility labels,
  correction rate, abandonment and perceived control. Pre-register acceptance thresholds with the
  product owner before build; fix critical misunderstanding and keyboard/accessibility blockers
  before visual refinement. Follow the standard layout, focus, mobile, reduced-motion and contrast
  checks below.

- A compact top mode selector displays shipped modes only. Recruiter mode is shown only with
  an eligible owned job; direct links still enforce permissions. With recruiter alone launched,
  a clear heading/job picker is sufficient; avoid a one-item tab bar.
- Desktop: collapsible recent-search rail, readable central transcript, composer anchored below
  the conversation. On mobile the rail becomes a drawer and results are one column; keep composer
  visible above the virtual keyboard and safe area. Use flex/min-height correctly; no whole-page
  horizontal scrolling or three tiny tabs forced onto a narrow screen.
- Job picker shows title, organisation, deadline and preparing/closed status; one job at a time.
  Below it, show Audience: Students / Graduates / Both, constrained by the approved job (§7.2).
  Explain that Graduates includes all affiliations and enrolled graduates may belong to both.
  Announce changes and preserve them per thread within memory lifetime. No silent reset on a
  refinement and no requirement to type the cohort into every prompt.
  URL mode/job/conversation state supports back/forward with server ownership validation. No criteria
  or sensitive snippets in URL parameters. No share-public-chat flow.
- Show the active criteria above results. Explicit Required/Preferred and Both/Either text,
  removable controls with accessible names, undo, conflict/clarification states and preview before
  applying a mixed request. Failed/refused turns leave prior results visible and labelled unchanged.
- Assistant text is templated. Cards show identity, evidence-match badge, exact/related tool tags,
  evidence completeness and “Not evidenced” gaps; no invented explanations. Evidence disclosure
  expands in place. **View profile** is the primary action (Connect lives inside `MemberDialog`,
  F16); secondary actions go in a menu rather than six equal buttons. Recruiter v1 has no
  More-like-this.
- Use the existing `MemberDialog` for View profile, with an optional turn-scoped match context
  verified server-side. `/members/[id]` does not exist; do not introduce broken links. A future
  permalink is a separately scoped feature. Keep the existing dialog usable without AI context.
- “Posted by” gets avatar and **View profile** via a permitted batched identity read; Connect stays
  inside `MemberDialog` (F16), where it is hidden/disabled appropriately for self, blocked/unavailable
  posters and global connection status. Do not auto-send or imply that applying requires contact.
  There is **one ConnectControl per open dialog**, never one per card. The programme's B25 fix gives
  it unique IDs (`useId`) and a single `connection_panel_state` RPC instead of four.
- Show progress stages immediately but publish **final ranked cards together** after completion,
  with a partial-state label if an assessment batch failed. Do not renumber “#3” as batches race.
  Announce one concise aria-live status, not entire expanding card contents. Preserve keyboard focus,
  user's scroll position and IME composition; Enter must not submit during text composition.
- Show quota remaining/reset, retry/cancel, job preparing/changed/closed, unavailable,
  no matches, low evidence, source refreshing and expired/deleted history states. The low-result
  state for recruiter mode says plainly that few members have opted in so far, without naming
  anyone (F28). Do not promise
  “about a minute” for JD preparation without measured queue latency.
- Show “Chat memory lasts 7 days”, source expiry and the memory/delete controls in §5.1. Explain
  when an expired criterion needs restating before running; never silently broaden a search.
  The posting form requires audience, shows it on approved cards/detail and routes members with
  unknown education status to a short confirmation form. Keep management access distinct from Apply.
- The recruiter job workspace offers Save findings and Check for new matches, shows last checked,
  seven-day expiry, New/Updated/Needs refresh and coverage/backlog states (§8.1). Reopening does not
  run a paid search. Explain cooldown, remaining quota and unavailable candidates without revealing
  why someone withdrew. Do not present changes in scores across different rubrics as progress.
- First-use explanation (one sentence + `/ai-notice` link, F22) plus persistent “AI-assisted
  matching. Evidence may be incomplete.” Link AI notice and data controls. Preview/switch off discovery and
  evidence sharing separately. Prompt existing members without blocking ordinary app use.

Validation: task-based usability before implementation and again on the built flow; desktop and
mobile, keyboard/screen reader, 200% zoom, reduced motion, long names, zero/one/ten cards, 15-turn
histories, slow network, reconnect and every empty/error/privacy state. Batched visual inspection
and one correction pass; do not claim usability or browser validation until it has been run.

## 13. Legal and compliance work

**Now, independent of AI (F15, owner: an immediate step).** The live privacy copy is false today,
separately from any AI work: `frontend/src/app/privacy/page.tsx:76-80` says extracted CV text is
"never stored" or sent to a third party and that matching is string-only, but the worker stores
`raw_text` (`worker.py:314`) and sends it to OpenAI (`worker.py:342`, `:361`, `:385`). Correct it
first, ahead of A0 and independently of the matching features. The legal wording comes from the
owner/reviewer; engineering supplies the factual description and wires it in. Tracked in
`tasks/todo.md`.

**Processors (F19).** PostHog is a processor today: it calls `identify(user.id)` with
`capture_pageview: true`, so page URLs reach PostHog with the member's identity. Add it to the
processor/ROPA rows below. AI custom events carry only bounded enums (never criteria, candidate
IDs or scores), and a PostHog `before_send` strips conversation/turn IDs from `/foundry-ai` URLs.
AI trace spans stay in our own Postgres, metadata only (§14, programme Part G9), so they add no
processor.

Existing public notices already conflict with shipped ingestion. Correct the factual statements
about text storage, CV history, external AI processing and GitHub processing in A0, before expanding
use. Changing wording alone does not retroactively obtain a lawful basis or erase historical
disclosures. Assess existing processing, recorded consent, whether re-notification/re-consent is
needed, and containment with the controller. Do not assert that a breach occurred without analysis.

Complete a DPIA covering ingestion, recruiter screening, network inference, self matching,
purpose/consent boundaries, discrimination/proxies, model errors, processor retention/transfers,
deletion, complaints and residual risk. Determine the lawful basis per purpose; being in a private
directory is not permission for employment profiling. Optional processing needs a real alternative
and withdrawal without detriment. Evidence sharing is a distinct disclosure.

Recruiter ranking/omission can influence access to jobs even if a human eventually hires. “Humans
decide” is not enough to declare automated-decision duties inapplicable. Document meaningful human
review, access to unranked discovery, correction/contest routes and bias monitoring. No ethnicity,
disability or other protected-trait inference for ranking; fairness evaluation using such data
requires its own lawful design, not guessing traits from names. Review provider usage restrictions
for consequential employment use as well as data-processing terms before enabling recruiter mode.

The controller/legal reviewer must determine UK rules, EU territorial scope, provider/deployer
roles and high-risk classification. Current Commission guidance checked on 2026-09-25 places the
Annex III employment high-risk timetable at **2 December 2027**; do not reuse an old 2026 blanket
deadline. Verify operative law and applicability again before release. AI disclosure is still a
product requirement regardless of whether a particular statutory duty applies.

OpenAI API data is not used for training by default unless opted in; document the actual account
settings. `store:false` does not remove default abuse-monitoring retention. ZDR/residency require
eligibility and confirmed configuration; no application or approval is claimed here. Record DPA,
subprocessors, transfer mechanism/assessment, selected endpoints, caching and actual retention.
Do not route sensitive data through unapproved eval/trace/conversation storage endpoints.

Update together, with accurate “current” versus “planned” status:

| Artifact | Required change |
|---|---|
| Privacy page, terms, signup/intake/profile copy | Actual ingestion; matching purposes; processor/retention; discovery/evidence choices; correction/objection; acceptable use |
| `01-architecture-data-flow-map.md` | Remove false no-AI claim; include egress projection, embeddings, inference and cache flows |
| `02-ropa.md`, especially N/O and retention table | CV version/text reality; separate matching purposes, lawful bases, recipients, retention, rights |
| `03-third-party-dpa-register.md` | OpenAI, PostHog (F19), Sentry and relevant hosting processor arrangements and configuration evidence |
| `07-dpia-screening.md` plus full AI DPIA | Mark old CV screening superseded for AI ingestion; preserve unrelated community/connections assessments |
| Internal handling, incident response, key rotation, compliance README | Access audit, AI spend/injection incidents, provider key revocation, deletion/backups, owner/legal evidence |
| OSA risk assessment and controller communications | Assess recommendations/contact amplification and update stale no-recommendation statements |
| New `/ai-notice` | Data used, limits, processor, explanation of scores, controls, retention and human review/contact route |

Drafting is engineering work; legal sign-off is a launch gate, not a claim of compliance or a reason
to stop unrelated local preparation. Verify filenames and live settings before publishing factual copy.

## 14. Build sequence and acceptance gates

**Now, independent of AI (before A0; programme phase 6 start):**

- F15: correct the live privacy copy about CV text storage and OpenAI processing (§13).
- F25 + B13: the scoped `cv_worker` login with `sslmode=require` (§10). Owner switches the VM env.
- B30: audit `AI-data-audit.md` and `docs/ai-migration-inventory.md` line by line against current
  migrations and code, correct them in place, and append the findings to AI-plan-review.md.
- Run a live `aclexplode` grant dump and confirm the dashboard region and compute tier.

**A0 — foundations before enabling any matching**

1. Implement local outbound policy, provenance/version migration, full nested validation, ingestion
   timeout/output/retry bounds (`OpenAI(timeout=…, max_retries=0)`, `max_output_tokens` on
   extraction and summary calls; F6) and version-aware dedupe. Keep ingestion behaviour covered with
   local fixtures; no `.env.local` (production). Inventory all OpenAI call sites and egress sinks.
2. Draft/correct existing factual disclosures and full DPIA; settle discovery/evidence decisions.
   Prepare versioned consent UX and audit records. Do not claim prior data was never transmitted.
   Include scalar-intake visibility and graduation/account-transition findings in AI-data-audit.
3. Prove restricted DB grants (executor RPCs in the non-exposed `ai_private` schema, revoked from
   `public, anon, authenticated`, checked with `has_function_privilege`; F17) and isolated service
   boot without worker/storage secrets. Add migrations for docs, requirements, conversations/results,
   attempts/ledger/leases (lease token + fencing, F1), version triggers and consent; typed
   concept/evidence/conversation/dependency graph, source archive and seven-day read-time
   expiry/purge (§5.1; clusters deferred, F10). New `ai_enabled` and per-mode flags follow the
   `connections_enabled()` pattern (F20). pg_cron runs purge/expiry/reconciliation (F31). Every new
   table cascades from member/opportunity FKs or joins the delete RPCs (F30). Jobs created through
   `admin_create_opportunity` carry a creation-source marker that excludes them from recruiter mode
   (F18). Implement education/posting audience
   migration and all exposure/action policies (§7.2). Add atomic invalidation before populating caches.
4. Implement budgeted document/JD refresh in the **existing CV worker** (F26), retries/reaper,
   backfill with kill switches and progress. Verify old workers cannot promote stale data; use an
   isolated local Supabase instance.
5. Capacity (amended F9/F33): the site-wide capacity work now runs in the launch-readiness
   programme before AI starts. Supabase is on Pro with **Medium** compute (owner, 2026-09-28), the
   Auth round trips are cut (B26), and the programme's E1b gates (250 then 500 distinct users,
   measured locally against a Medium-sized DB container, then once in the pre-launch prod window)
   replace this step's staging copy. A0 adds only the AI-specific parts: the fake-provider 500
   submission burst locally, and the fra1-vs-lhr1 measurement (F8). The ACA/Vercel deployment
   spike and cost comparison is part of A0; do not provision a third VM by default.

**A1 — recruiter end-to-end**

1. Implement `server/app/ai/{config,client,privacy,spec,interpret,retrieve,assess,score,memory,
   budget,service}.py` (split only as useful) and a durable runner. One owned approved open job.
2. Build labelled retrieval/scoring and adversarial fixtures before tuning; validate source quotes.
   Include the student/alumni/experience cases in §7.1 and paired memory-cost benchmarks in §5.1.
   Add approved audience/level requirements and optional self-reported experience/projects input.
   Implement the custom harness in AI-evaluation-plan.md; run objective-level gates before model,
   prompt, taxonomy or weight selection. Include broad plus specific coverage (§7.3), method/
   nonsoftware evidence, no-CV members, parser ambiguity and independent requirement review.
3. Build chat/refinement, job picker, match dialog context, shortlist persistence, independent
   feature flags and admin aggregate usage (including the opted-in ready-projection count, F28).
   Add Posted-by identity and View profile as described above; Connect stays in `MemberDialog` (F16).
   Include seven-day saved findings, bounded incremental rescans and change-feed coverage (§8.1).
4. Add dedicated container/CI/mock client, provision scripts/runbook and origin protection. Any
   real deployment, provider-account changes or real-data backfill are separately reviewable
   operations; this review does not execute them.
5. Pass the gates below, legal/configuration review and a measured local synthetic OpenAI smoke
   before rollout. **Rollout (F27, owner):** no pilot list; the recruiter flag goes on for everyone
   once the gates pass (F33 meaning of staging). Roll back by flags/revision without destructive
   schema undo.

**A2 — network:** same boundary and ledger; interests/course/intent criteria, deep-learning→chess
flow, explicit consent scope, typed similar-to if privacy-safe, network-specific relevance evals.
Add seek/offer and purpose-specific availability, shared versus complementary intent and current
connection state handling from AI-data-audit. Do not reuse hiring relevance as network relevance.

**A3 — opportunities:** own permitted projection, open-job retrieval, fit explanations and Apply/
View-profile guidance (Connect via the dialog, F16), source-missing UX and reciprocal-score tests where criteria are identical.
Add owner-private job preferences and structured job logistics; evaluate skill fit separately
from preference compatibility, dates and self-reported application state (AI-data-audit §5).

| Gate | Evidence required before launch |
|---|---|
| Access/privacy | Negative tests: arbitrary actor/candidate/turn IDs, expired/stale leases and fencing, admin-created jobs never unlocking recruiter mode while an admin's member-flow job does (F18), `ai_private` functions not executable by `anon`/`authenticated` (F17), replay, direct RPC bypass, inherited grants, pending/non-owned/expired jobs, committee/self/blocks, ban mid-turn, consent withdrawal mid-call/cache/replay, delete/recreate and stale worker completion |
| Egress | Intercept **every** SDK transport request including moderation, embeddings, retries and GitHub/summary jobs; synthetic names/phones/emails/URLs/secrets/sensitive facts do not escape; uncertain input is held locally; forced errors contain no payloads |
| Relevance | At least 150 adversarial and a separate benign set: mixed math/code requests, legitimate teaching/programming search, negation/OR, multilingual input, zero-width/encoded injection, malicious CV/JD and cross-candidate contamination. Zero off-task answer rendering/unauthorised operations; target >=95% supported benign-intent handling. Report denominator and failures, no universal safety claim |
| Quality | Begin with 20+ jobs, network queries and distinct job-seeker profiles as a smoke set; size locked held-out sets from pre-registered confidence-interval precision and ensure independent coverage of each mode/high-risk slice before claiming metric targets. Plant C1 profiles in 2k/10k diverse synthetic records with hard negatives and selective consent. Provisional retrieval recall@200 >=95%, nDCG@10 >=.80 and 100% required/explicit-tool invariant cases; compare lexical baseline. Tune gates before seeing held-out results; report uncertainty and sparse-data cohorts; an underpowered slice is inconclusive, not passing |
| Score stability | Unrelated pool additions do not change an unchanged candidate's evidence score; required means met, NOT/OR preserved, no denominator-zero, unknown distinct, source negation (“no PyTorch experience”) not positive evidence |
| Specific + broad skills | Both contribute where requested; no reverse category inference, cosine-as-proficiency, ancestor/alias double-counting or ignored unmapped methods; exact-tool and broad-only objectives pass independently; versioned seed/extraction changes trigger evals |
| Experience/cohorts | Explicit student eligibility respected, open-role cohort-label swaps do not alter score, irrelevant tenure gives no bonus, duration overlap not doubled, missing CV/dates unknown, ongoing-duration caches refreshed, duplicate evidence does not increase score |
| Audience/visibility | Students/Graduates/Both use education facts across every affiliation; postgraduate overlap deduplicated; posting audience cannot be widened; unknown status, direct reads/actions, legacy jobs, pending edits, community posts and mid-turn changes covered; management access does not confer Apply access |
| Memory graph | Correct cross-chat source retrieval within seven days via source-span search (clusters deferred, F10); current valid constraints preserved; owner/purpose boundaries enforced; source expiry removes derived specs/summaries/vectors and late workers cannot restore them; failed reindexing covered (mixed-age clusters only if the deferred clustering step ships); private terms never promoted globally; net cost includes graph/SLM maintenance |
| Saved findings/rescans | Seven-day expiry without renewal by reads/reuse; candidate withdrawal and job closure suppress saved results; ready-feed late commits not skipped; changed existing members and new opt-ins included; cursor compaction recovers safely; no-change uses zero provider calls; duplicate refreshes coalesce and scan backlogs stay bounded |
| Concurrency/cost | 500 simultaneous submission attempts across separate app/worker replicas exercise bounded durable admission, DB pool limits, duplicate idempotency races and fast overload responses; a separately measured active-turn ceiling (starting at min(50, RPM/TPM-derived)) and a separate in-flight provider-request cap (F3) cannot exceed shared TPM/RPM or monetary caps. Duplicate lease completions, cancellation, timeout-after-bill, retries, midnight, crashes, cache miss via chips, model price changes and background fan-out are covered |
| Production capacity operations | Dashboard and privacy-safe alerts cover active/configured turns, queue depth/age and enqueue-to-start percentiles, rejections, provider latency/429/5xx/RPM/TPM headroom, ACA worker and Supabase pool pressure, status-poll volume, and reserved/settled/projected spend. A documented operator procedure requires sustained queue demand plus healthy dependency/cost headroom, a versioned shared cap change, small staged increment/canary, representative peak observation, and tested rollback; no automatic ceiling increase or quota/cost/privacy relaxation |
| Latency audits | Repeatable baselines during development and before release/limit increases report browser Web Vitals and p50/p95/p99 across route, Auth, DB, cache, queue, provider stages and time-to-useful-result for cold/warm and realistic data/load cohorts; regressions have attributable traces and are retested after fixes without logging prompts or member data |
| Admin visibility | Authorized admins can see aggregate operational health and AI usage; only a separately granted AI-operator capability can change the shared ceiling/kill switch. Access is audited, content/PII/secrets are absent, and dashboard/control outage cannot bypass server-side admission limits |
| Recovery | Browser disconnect/reconnect without duplicate paid attempt; runtime restart/reaper; DB/Upstash/OpenAI outage; stale specs; partial assessment; rolling revision/rollback; origin bypass denied. Before launch, owners define service RTO/RPO for app reads/writes, queue and saved findings; test backup restore, queue replay/expiry, privacy deletion replay after restore, uncertain provider billing and no duplicate calls/results against those objectives. |
| Load | **500 distinct authenticated synthetic identities/virtual users** for 30 minutes, locally against a Medium-sized DB and once in the pre-launch prod window (F33; programme E1b/E5), with realistic browsing, filtering, profile/listing reads, background status views and a measured burst profile; ramp 50→100→250→500→750, soak and recovery. Include a baseline near 50 page requests/second (500 users each navigating about once every 10 seconds, per C6), a separate synchronized spike, 2k/10k directory corpora, unique sessions (no reusing 20 logins as a 500-user simulation) and representative read/write rates. Exercise reads plus realistic bookmark/connection/profile/listing mutations and duplicate/retry races. Starting AI assumption: up to 50 simultaneously running provider turns, plus a separately bounded durable queue with explicit wait/age limits; derive active provider concurrency from RPM/TPM, DB and cost ceilings. Separately burst 500 AI submissions and prove fast bounded acceptance/rejection, no unreserved provider calls and useful retry messaging. Provisional goals: server-rendered page p95 <2s and p99 <5s, normal directory/listing query p95 <500ms, retrieval DB p95 <100ms, no-provider-call AI paths (chip rerun, replay, reopen) p95 <2s, natural-language turn with all assessments cached p95 <6s provisional (F4), uncached AI result p95 <15s with a 45s worker-execution deadline excluding bounded queue wait. Hold request error rate below 1%, keep DB/worker pools and queue age within safe limits, preserve writes exactly once under retry, and show no cross-user result leakage under concurrency. Run 1,000 VU headroom and dependency-failure/recovery tests before claiming 500-user readiness. Report hardware, replicas, pool limits, traffic mix, spend and confidence; local mocks alone do not prove hosted capacity. |
| UI | Desktop/mobile, accessible labels and unique IDs, keyboard-complete combobox/listbox or native control semantics, no nested clickable-card collisions, >=44×44 CSS px primary touch targets, visible profile-load recovery, one ConnectControl per open dialog (F16), final stable slot order, no broken profile URLs, permission/limit/empty/stale states and existing Apply/Connect regression checks, every new control with a visible border (F23). Evidence is the §14.4 Playwright audit plus its visual pass. Detector output alone does not satisfy this gate; run browser/assistive-technology checks on the actual built page. |
| Economics | Measure uncached/cached turn cost by stage, all billed attempts and background costs; document expected volume supported by $5/$10/$15 caps; include ACA warm-replica idle cost (F5). No mandatory cache-hit percentage or guessed price acceptance |
| Compliance | Controller-approved DPIA/notices/consent and processor settings; applicability/meaningful-review decision recorded; complaint/DSAR/deletion path exercised; self/admin/job/graduate deletion succeeds with AI rows present (F30) |
| Custom eval harness | Versioned labelled datasets, stage/end-to-end adapters, deterministic invariant checks, calibrated optional model graders, held-out runs/repeats and cost-bounded JSON/HTML reports per AI-evaluation-plan.md; no omitted or failed checks reported as passed |

Use pytest, SQL privilege/RLS integration tests, Vitest and rebuilt Playwright against local
Supabase with deterministic mocks. The current `_StubOpenAI` lacks Responses/moderation and emits
zero vectors; extend it for contracts and realistic nonzero retrieval fixtures rather than assuming
it tests matching. Real OpenAI evaluation uses synthetic/minimised data, explicit cost ceiling and
manual execution. Production is used for load only in the owner-approved pre-launch window with its safeguards (programme E3); never after launch, and never with the fake provider. Run Graphify update after code
changes; record measured validation, not checked boxes for unbuilt controls.

### 14.1 Abuse-testing programme and release evidence

Implement and exercise these tests against an isolated local/staging deployment with synthetic
members/jobs and intercepted provider transports. Start with deterministic unit/property tests,
then real Postgres transactions, multiple service processes and HTTP/browser integration. Paid
OpenAI checks are a separate small synthetic evaluation with an explicit ceiling; never use real
provider spend or production load to demonstrate that a rate limit works. No such tests have run
in this planning-only review. A passing suite supports specific controls, not a claim of perfect
security or that prompt injection has become impossible.

| Attack/failure family | Required misuse cases and observable assertions |
|---|---|
| Each configured limit | Generate boundary tests from the policy registry: N−1/N/N+1, simultaneous boundary requests, reset/rolling windows, clock skew and long-running reservations; prove allowed/denied counts across replicas, not just HTTP status text |
| Unmetered entry points | Direct API/RPC/server action, alternate method/route, missing/expired/stale lease or replayed turn, disabled feature, missing Redis/config/price, worker retry/reaper/SLM/JD/embedding paths; every actual outbound call has a prior valid reservation |
| Identity/bypass | Same member across devices/tabs/IPs/modes/jobs/threads; changed client IDs/idempotency keys, copied tokens and revoked sessions; spoofed forwarding headers, alternate origins, multiple approved accounts and shared-campus NAT; aggregate money cap holds without indiscriminate NAT lockout |
| Input/caching attacks | Oversize Unicode/encoded/compressed bodies, enormous structured arrays, malformed JSON, repeated off-task/injected prompts, unique near-duplicate specs, adversarial cache misses, negative-result churn and expensive source refreshes; pre-admission denials make zero provider calls and storage cardinality stays bounded |
| Race/retry/accounting | At least 20 real concurrent reservations, same/different keys, same-job scan races, cancel/disconnect/reconnect, timeout after provider success, double settlement, worker crash before/after dispatch, lease takeover, midnight/month boundary and delayed usage; no overspend, duplicate paid replay or premature reservation release |
| Outages/queues | Redis, DB, provider 429/5xx, poll failures and rolling restart; no paid fail-open, no retry storm, fair bounded queues, conservative unknown usage and no burst replay on recovery; permission-dependent reads unavailable if live authority cannot be checked |
| Read/resource exhaustion | Status/history polling floods, save/delete/check loops, pagination, huge graphs and highly selective vector filters; bounded DB time/memory/rows, safe backpressure and reserved privacy controls; cache hits still rate limited |
| Privacy/injection | Cross-owner graph traversal, forged result refs, hostile CV/JD/history, mixed legitimate/off-domain prompts, source expiry and withdrawal mid-assessment/recluster/rescan; no leaked identity/contact/evidence, off-domain output or restored expired data |
| Delta/quality | New eligible student, graduate faculty, late-ready CV, existing opt-in, same-byte source under changed policy, job edit, backlog larger than caps, out-of-order publication and feed compaction; no silent skipped interval or false exhaustive-scan claim; evaluate recall and score stability against fresh retrieval |

For each family record fixture/seed, exact build/config, expected and observed admitted requests,
provider calls/tokens, peak outstanding money, settled/unknown charges, queue depth and failures.
Use a provider spy that can report success after client timeout and a fault-injection clock/runner;
verify DB invariants independently of UI messages. Property-based random action sequences should
mix edits/scans/retries/expiry/consent changes and assert the same invariants after each step.
Treat an unreserved call, quota bypass, unauthorised result or expired-data resurrection as a launch
blocker. Keep failed adversarial cases as regression fixtures; do not hide failures by weakening
assertions. After rollout use minimised aggregate monitoring, alerting, kill switches and regular
review of unit economics, denied traffic, retrieval quality and sparse-data cohorts.

### 14.2 Additional product gaps to resolve through implementation evidence

- **Freshness and coverage:** show profile/job source age and partial scan status; “no matches” may
  mean insufficient evidence or unprocessed updates. Never promise every suitable person was read.
- **Fair exposure and cold start:** students/new members/no-CV graduates need usable structured
  evidence and retrieval tests; old saved shortlists must not permanently crowd out newcomers.
  Measure these effects without adding a hidden new-user, tenure or alumni score multiplier.
- **Job quality and abuse:** approved job text can still be misleading or later become obsolete.
  Preserve reporting/moderation, closure controls and ownership checks; AI matching is not employer
  verification. Avoid broad harvesting through many near-identical approved postings and apply
  the distinct-candidate/member budget across all of a recruiter's jobs.
- **Availability and intent:** offer explicit, optional work preferences (role type, location/remote,
  availability) when needed; unknown must stay unknown. Do not infer job-seeking from network chats
  or expose private career intent to a current employer without the corresponding disclosure choice.
- **Human decisions and correction:** explain missing evidence versus disqualification, let members
  correct source facts, and keep reports of bad matches. Do not treat a numeric score as an automatic
  rejection or proof that a candidate is suitable. Do not auto-contact or auto-apply.
- **Economics and graceful degradation:** benchmark cost per useful saved match and refresh, not just
  per API request. Under budget exhaustion retain authorised saved results and ordinary search;
  show reset information and do not silently switch to a less capable untested model.

### 14.3 Consolidated gap-closure contract and final review boundary

The following controls are cross-cutting prerequisites, not optional polish. They restate the
audited gaps as concrete build and release obligations so that they cannot be lost while work is
split across migrations, API, workers and UI:

| Gap | Required design/implementation | Release evidence |
|---|---|---|
| Skill accuracy | Preserve exact terms, typed broad concepts, reviewed aliases, unmatched terms, polarity, source/version and source-span evidence. Keep taxonomy-mapping similarity separate from evidence confidence and proficiency. Link facts to roles/projects/tasks where the source supports it; unknown dates/depth stay unknown. | Exact-tool, broad-only, OR alternative, negation, ambiguous alias and unmapped-term fixtures; source-grounding checks; no alias/ancestor/duplicate-evidence score inflation. |
| Recruiter requirements | Parse mandatory, preferred and explicit alternatives as distinct typed criteria. Show a source-linked preview for poster confirmation; retain unresolved/conflicting requirements as unresolved instead of inventing a hard constraint. Chat refinements are versioned separately from approved JD facts. | Required predicate tests before scoring; poster edits/version changes invalidate dependent assessments; false mandatory interpretation and unconfirmed JD extraction are visible and block an authoritative shortlist. |
| Network intent | Store optional seek/offer, purpose-specific availability and shared-versus-complementary goals separately. Existing wants, roles and generic availability do not imply offers. Keep networking criteria/rubric independent of hiring. | Paired seek/offer and shared/complementary fixtures; current consent, open-to-connection, block and connection-state checks on retrieval and publication. |
| Job preferences | Keep capability, hard eligibility and personal preferences in distinct fields and outputs. Structure role logistics where needed; location, pay, schedule and start-date unknowns remain unknown. An evidence score is not preference compatibility or application eligibility. | Scores are invariant when only preferences change; explicit preference view and Apply eligibility are separately tested. |
| Privacy/grants | Inventory every column grant, RLS policy, view, function overload/owner and downstream projection. UI omission does not imply confidentiality. Use owner-private stores for private work preferences and purpose-scoped model projections; do not widen database access for convenience. | Direct SQL/RPC, inherited-grant, unauthorised field, cache, outbound-transport and mid-turn withdrawal tests show zero private-field disclosure. Public notices and data-flow records match actual processing before launch. |
| Graduate lifecycle | Retire graduation-year bulk deletion as a status-transition mechanism. Preserve graduate accounts across affiliations; model education facts separately from directory role and audience eligibility. Preserve actual account deletion and secure identity/email transition. | Graduate faculty, enrolled graduate, recently graduated, unknown and duplicate-account lifecycle tests; no cutoff job deletes accounts; all audience paths use the same applicant predicate. |
| Freshness | Version and invalidate every relevant source independently, including skill/sector/interest/intent junctions, CV, taxonomy, GitHub showcase, consent, education, job skills/criteria and audience. Fence asynchronous workers and re-authorise saved results at read time. | Child-row-only changes, source removal, withdrawal, job edit, late worker and rescan cursor tests prove no stale result is published and no valid update is silently skipped. |
| Model evaluation | Build the objective-based harness before recruiter launch. Use model graders only for bounded semantic judgments; deterministic authorization, eligibility, exact requirements, score arithmetic, provenance existence and spend controls cannot be overridden by a grader. | Human-calibrated grader report, locked held-out set, separate benign/adversarial suites, zero critical invariant failures, per-objective/slice results and cost including grader calls. |

Do not report a percentage as probability of hiring success, candidate quality or model confidence.
Show the evidence-match score, requirement status, evidence completeness and freshness as separate
signals. A candidate who fails a confirmed mandatory criterion must never be presented as meeting
the requirement because their aggregate score is high. A human can inspect the wider eligible
directory; no score triggers automatic rejection, contact or application.

The follow-up UX, capacity and deployment review added concrete findings R45 onward in
[AI-plan-review.md](AI-plan-review.md), based on existing UI source, deployment notes and official
platform guidance. The consolidated contract now covers the known repository-backed gaps; that is a
bounded statement, not certainty that implementation or launch review will uncover nothing else.
The implementation must still recheck current migrations, grants, provider configuration and legal
guidance at build/release time. One capacity issue is already known: [C6](docs/audits/C6-launch-capacity-and-connections.md)
reports a **failed local authenticated-load integration** at both 100 and 500 VUs. Its controlled
500-VU run had 84.79% failed page checks, many `UND_ERR_SOCKET`/`fetch failed` calls to local
Supabase, and auth redirects in the sample; it reused 20 identities, so it is neither a valid
500-distinct-user pass nor a measure of production capacity. Treat it as an unresolved failure to
isolate and rerun in staging, not as proof that production is broken or safe. The 500-user gate is
not met until a distinct-identity run on the intended deployed architecture passes with source
telemetry and database/provider headroom.

The following remain evidence dependencies rather than decisions that repository review alone can
settle:

- The controller/legal reviewer must decide lawful basis, notices, consent/objection, employment
  profiling duties, protected-cohort audit design and provider terms for each launch jurisdiction.
- The product owner must approve field-level discovery/evidence choices, score presentation and
  how ambiguous job requirements are resolved. Safe defaults remain opt-in and unknown stays
  unknown; no implementation should silently broaden disclosure to make matching easier.
- The measured labelled set may reveal that a proposed taxonomy, extraction field, threshold,
  score component or clustering step does not improve useful matches. Keep those components
  behind versioned flags and remove or revise them based on held-out evidence and cost.
- Repository review cannot prove the deployed database has run every migration, that grants and
  secrets match source configuration, or that external application destinations enforce Foundry's
  audience rules. Deployment snapshots, isolated integration tests and provider/account checks
  are required before launch.
- The current live Supabase tier/region, Vercel Function region/plan, ACA quota/cost, cache/Redis
  separation, OpenAI RPM/TPM, and actual per-stage latency/cold-start behavior must be read from
  deployment dashboards and measured in staging. Existing compliance notes identify Supabase as
  London and Vercel as Frankfurt, while the capacity audit says live settings still need checking;
  reconcile these records before selecting regions or making residency claims.

### 14.4 Full-functionality Playwright audit (added 2026-09-27, F13/F24/F32)

The current suite has one Desktop Chrome project, no mobile, and no spec for `/admin/graduates`
(a destructive bulk delete), `/admin/reports`, `/admin/community`, the admin `/…/new` forms,
`/opportunities/[id]/edit`, `/vcs/[id]/edit`, `/committee`, `/community/mine` or `/foundry-ai`. CV
upload → processing → ready is only seeded, never driven through the UI, and `a11y.spec.ts` covers
about 14 pages. This audit closes those gaps and becomes the evidence for the UI gate.

- **When:** before A0 changes existing pages (baseline), at the end of each phase A0–A3, before each
  mode is enabled, and before any concurrency-ceiling increase.
- **Environment:** a freshly rebuilt production build (`pnpm build` in the same script as the run)
  against an ephemeral local Supabase with a deterministic fake provider. Playwright `webServer`
  also starts the Python executor, and the CI E2E job sets up Python (F32). Never production and
  never `.env.local`. Live-provider smoke runs stay in the eval plan's cost-capped mode.
- **Coverage matrix, checked into `frontend/e2e/`:** every `src/app/**/page.tsx` route × every
  role that can reach it (logged-out, pending, rejected, student, graduate/alum, recruiter with an
  eligible job, admin, AI-operator). A unit test fails when a new `page.tsx` has no matrix entry.
  Close the gaps above first; `/admin/graduates` uses a throwaway fixture because it deletes
  accounts. Drive CV upload → processing dialog → ready through the UI.
- **Devices and accessibility:** a mobile project (phone descriptor); keyboard-only paths, 200%
  zoom/reflow and reduced motion; axe on every page and every AI state; 44×44 primary touch targets.
- **AI flows:** each mode's happy path and refinement (Deep Learning → then chess), the mixed-prompt
  confirmation and off-task refusal; budget exhausted, queue busy, outage, partial result, expiry,
  forget/delete and both consent toggles; recruiter-mode gating; a Students/Graduates/Both job
  hidden from ineligible viewers across list, detail, home, bookmarks and community posts; stable
  slot order, no duplicate DOM IDs, and one ConnectControl per open dialog (F16); View profile opens
  `MemberDialog` and Apply/Connect keep working.
- **Network assertions (`page.on('request')`):** the browser never talks to ACA or OpenAI; no
  criteria in URLs; AI responses are `Cache-Control: no-store`; polling never has more than one
  request in flight and stops on hidden tabs; reopening a saved result triggers no provider call.
- **Negative gating:** an admin-created job never unlocks recruiter mode, while an admin's own
  member-flow job does (F18).
- **Audience cutover:** an unconfirmed member sees the confirm-status prompt, not an empty board (F29).
- **Deletion:** with AI rows present, self-delete and admin delete still work end to end (F30).
- **Evidence:** HTML report plus traces on failure. Skipped or failed cases block the UI gate.
  Record the E2E job runtime at each gate; the suite stays in one job until it reaches about 75% of
  the CI time cap, then AI specs move to their own job (F24).
- **Visual pass:** a separate interactive browser pass (Playwright MCP) checks that every control
  has a visible shape (F23), since the earlier review had no browser inspection.

## 15. References checked during review

- [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): objective-led datasets/metrics, continuous regression evaluation and human calibration of model graders. The project-specific harness contract is in AI-evaluation-plan.md.

- [Azure Container Apps scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app): replica floors, HTTP concurrency and scaling behavior; `minReplicas` keeps a warm baseline, while scale-out and ingress still need measured headroom.
- [Azure Container Apps reliability](https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps): zone redundancy, replica-loss behavior and data/state expectations. Confirm current region and service feature support before provisioning.
- [Azure Well-Architected guidance for Container Apps](https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-container-apps): warm replicas, health probes, scaling, resource limits and ingress availability recommendations.
- [Vercel Function regions](https://vercel.com/docs/regions) and [region configuration](https://vercel.com/docs/functions/configuring-functions/region): function placement relative to data sources; verify live project settings before moving compute.
- [Vercel Function duration](https://vercel.com/docs/functions/configuring-functions/duration): request duration is billable and plan/runtime limits must be checked before putting long work in a function.
- [Vercel CDN caching](https://vercel.com/docs/caching/cdn-cache): static/shared caching versus sensitive and user-specific responses.
- [Existing capacity audit](docs/audits/C6-launch-capacity-and-connections.md): 500-user target, local authenticated-load failure, Supabase/Vercel measurement gaps, request polling and pre-launch staging gates. The controlled local failure is not a production capacity result.

- [OpenAI agent safety](https://developers.openai.com/api/docs/guides/agent-builder-safety): structured boundaries reduce risk, without eliminating injection.
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): schema constraints and refusal/error handling.
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data): endpoint retention, `store`, ZDR and caching distinctions.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): reuses shared prompt-prefix computation; distinct from Foundry's stored facts and assessment memory.
- [OpenAI project spend alerts](https://developers.openai.com/api/docs/guides/terraform/rate-limits-and-spend) and [Admin APIs](https://developers.openai.com/api/docs/guides/admin-apis): project alerts versus organisation hard limits.
- [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) and [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini): initial model candidates; deployment access/snapshots still require verification.
- [pgvector](https://github.com/pgvector/pgvector): filtered ANN, iterative scans and exact-search comparisons.
- [ICO recruitment review](https://ico.org.uk/about-the-ico/what-we-do/recruitment-rewired/) and [DUAA changes](https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-duaa-summary-of-the-changes/data-protection/): meaningful review, safeguards and profiling concerns.
- [ICO valid consent](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/what-is-valid-consent/): genuine choice and purpose-specific permission; compulsory unrelated processing cannot simply be called consent. Guidance is flagged by ICO as under review following DUAA.
- [European Commission AI Act guidance](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai): high-risk categories and current timeline; obtain case-specific legal assessment.
- [Azure Container Apps client certificates](https://learn.microsoft.com/en-us/azure/container-apps/client-certificate-authorization): ingress passes certificates for application validation; source-IP restrictions alone do not establish origin identity.

## Appendix A. Launch tunables

Added 2026-09-27 (F12). The one place to read every starting limit. Values are copied from the
section cited, changed only where F3–F5 corrected them. If a section and this table ever disagree,
the section is authoritative and this table is the bug; fix both in the same change.

| Area | Tunable | Starting value | Section |
|---|---|---|---|
| Search spec | Atoms / OR groups / result exclusions | 12 / 4 flat groups / 10 | §5 |
| Retrieval | Candidates retrieved / evidence cards assessed / final cards shown | 200 / 20 / 10 | §6 |
| Admission | Admitted attempts per member | 5 per minute | §9 |
| Admission | Runs per member (shared across all modes, rescans, new conversations) | 40 per rolling 24 h | §9 |
| Admission | Validated draft-chip edits | 200 per day | §9 |
| Admission | Executed turns per thread / active threads | 15 / 5 | §9 |
| Admission | Distinct members surfaced per viewer (checked at admission, F7) | 150 per rolling day | §9 |
| Admission | Tokens per member (secondary to money and call caps) | 200k per day | §9 |
| Money | Daily matching ceilings | $5 recruiter / $10 + network / $15 all modes | §9 |
| Money | Budget alert | 80% | §9 |
| Money | Ingestion per-member gate (existing) | 30 LLM jobs per day (`llm_job_budget_available`) | §9 (F6) |
| Execution | Logical calls per turn | 1 interpreter + 4 assessors, assessors in parallel (F3) | §9 |
| Execution | Retries | 0 SDK retries; at most 1 explicit retry per call, only if the deadline allows | §9 |
| Execution | Per-attempt timeout / turn deadline | 20 s / 45 s, from claim (queue wait excluded) | §9 |
| Capacity | Active turns | min(50, derived from measured RPM/TPM) (F3) | §9, §10.1 |
| Capacity | In-flight provider requests | separate cap, derived from RPM/TPM (F3) | §9 |
| Capacity | Ceiling raise step | at most 20–25% per step, operator-only | §10.1 |
| Capacity | ACA warm replicas | 1 at launch (F5); 2 only when measured SLO justifies | §10.1 |
| HTTP | Request body / message length | 4 KiB / 600 Unicode characters plus a token limit | §10 |
| Reads | Result/status/history reads | 60 per minute per member | §9.1 |
| Reads | Status polling | 1 in flight per turn per tab; ~1 s → 2 s → 4 s with jitter, capped; paused on hidden tabs (F2) | §9, §10.1 |
| Reads | Rescan-check metadata / draft operations | 12 / 30 per minute per member | §9.1 |
| Rescans | Active scans per job / cooldown / rescans per job | 1 / 5 minutes / 10 per rolling day | §8.1 |
| Retention | Chat history and derived memory; saved findings | 7 days, rolling | §5.1, §8.1 |
| Latency targets | No-provider-call paths (chip rerun, replay, reopen) | p95 < 2 s | §14 (F4) |
| Latency targets | Natural-language turn, all assessments cached | p95 < 6 s, provisional (F4) | §14 |
| Latency targets | Uncached AI result | p95 < 15 s | §14 |
| Site capacity | Programme gates | Stage 1: 250 users, p95 < 1 s; Stage 2: 500 users, p95 < 2 s | programme E1b |
