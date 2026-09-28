# AI feature data and migration audit — 2026-09-26

This supplements the authoritative [AI plan](AI-plan.md). It identifies data the three modes can
use, distinctions they must preserve, and missing product/schema work. No application code,
migration, live data or provider configuration was changed.

## Scope and evidence

Inventoried **all 134 SQL migrations, 24,600 lines**, from `20260527000001` through
`20260917000019`. All 134 paths have source nodes in the existing Graphify graph. Used Graphify
queries and focused node explanations, then inspected SQL definitions and their later replacements
for the relevant schema, grants, lifecycle and read/write paths. Also checked the CV/GitHub
producers: migrations alone cannot establish the shape or reliability of JSONB contents.

The [complete migration inventory](docs/ai-migration-inventory.md) records each file's fingerprint,
objects and review role. This is static feature/data-flow review, not execution of every migration
or certification that production matches the repository. Graphify contains historical definitions
as well as current ones; broad query results were truncated, so focused explanations and source
checks supplied the relevant detail. Graphify reported skill/package versions 0.9.50/0.9.53;
queries worked, and no tool installation or graph rebuild was needed for this documentation work.

## 1. Available information by feature

R = recruiter matching; N = network discovery; J = the member's own job finder. Availability in a
table does not imply permission to use or disclose it. Every use inherits the plan's consent,
minimisation, source-version and eligibility boundaries.

| Information and actual source | R | N | J | Interpretation and missing work |
|---|---|---|---|---|
| `profiles.course`, role, grad year; [initial schema](supabase/migrations/20260527000001_initial_schema.sql), [course](supabase/migrations/20260529000003_onboarding_expansion.sql), [six roles](supabase/migrations/20260828000002_six_roles_constraints_and_rpcs.sql) | Job-relevant study requirements | Explicit course/affiliation search | Subject/level context | Course is free text. Add reviewed course aliases without assuming similar titles are the same degree. Role/year do not prove current enrolment or completion; use planned education facts. No institution prestige score. |
| `profile_skills.is_core`, `skills.category/aliases`; [taxonomy](supabase/migrations/20260901000001_skills_taxonomy.sql) | Broad self-declared capabilities | Expertise search | Broad initial retrieval | Core is a member's top-three selection, not verified seniority. These aliases include tools under broad categories and are not exact-tool synonyms. |
| `profile_sectors`, `opportunity_sectors`; [initial schema](supabase/migrations/20260527000001_initial_schema.sql), [sector seed](supabase/migrations/20260527000004_seed_data.sql) | Supporting job context | Shared domains | Industry interests | A chosen sector is an interest, not proof of industry experience. The same sector appearing on both sides is not an exact skill match. |
| `bio_focus`, legacy `working_on`, `bio_hobbies`; [cutover](supabase/migrations/20260901000007_directory_bio_avatar_cutover.sql) | Relevant work statements only | Current work and hobbies | Self context/preferences only where explicit | Use full authorised source, not 160-character card previews. Respect latest bio and documented legacy fallback; avoid duplicate facts. Hobbies never contribute to recruiter ability scores. |
| `profile_interests(kind,label)` academic/hobby; [definition](supabase/migrations/20260901000005_interests_and_intents.sql), [scoped policies](supabase/migrations/20260901000011_scope_interest_intent_policies.sql) | Excluded as hobby/personality evidence | Explicit academic/chess/etc. criteria | Optional self interest alignment | Owner/admin SELECT, not ordinary directory access. Need purpose-consented projection; interest is not demonstrated skill. Free text needs negation, aliases and sensitive-topic checks. |
| Ranked `profile_intents`, including `find_mentor`, `technical_help`, `find_cofounder`, `meet_people`; [v2 values](supabase/migrations/20260901000010_intake_v2.sql) | Not implicit employment availability | Relationship purpose | Self context, not job capability | Up to three ranked wants. No equivalent structured offers exists: wanting a mentor does not mean offering mentoring. Add optional offer/seek fields and per-purpose disclosure. |
| `current_focus`, `intent_urgency`, `availability_hours`; [intake columns](supabase/migrations/20260901000004_intake_columns.sql) | Only separately confirmed work preferences | Collaboration context | Prompt to confirm current job preferences | Generic intake context, not guaranteed job-seeking consent, start date or employment hours. Store purpose and confirmed-at; do not assume `full_time` means available for this job. |
| `venture_stage`, one-liner, `recruiting_status` | Job context only if connected to the actual posting | Cofounder/startup/advisory discovery | Explicit interest in joining a venture | `recruiting_status` describes whom the member is hiring, not the member's own desired role. Stage alone does not show skills or hiring authority. |
| `cvs` status/current; `cv_profiles.profile.skills_raw`, projects/roles; [pipeline tables](supabase/migrations/20260906000001_cv_matchmaker_pipeline.sql), [producer](server/app/cv_pipeline.py) | Specific tool/task evidence | Consented expertise | Candidate side of JD comparison | Use current ready safe projection with source spans. Extraction already preserves tools; provenance, qualified assertions and some methods still need work (§2). |
| `member_skills(raw_text,skill_id,confidence,source)` and `cv_skills` | Candidate generation | Expertise retrieval | Candidate generation | `confidence` currently means embedding similarity to a taxonomy label, not skill proficiency or evidence certainty. `source` distinguishes CV/GitHub, but lacks CV/repo/span version linkage. |
| CV education level/course; roles start/end; projects role/technologies | Relevant education/tasks/duration | Specific expertise | Eligibility evidence and fit | Education completion is expected year, not verified completion. Projects lack structured dates; role schema lacks explicit per-role technologies. Do not assign a flat skill to every role or invent project duration. |
| CV `languages`, grade | Only explicit justified job requirements | Explicit language criterion if permitted | Explicit language requirements | Spoken languages are separate from programming languages. No nationality/native-speaker inference; grades are not default ranking signals. Certification/licence validity is not structured today. |
| `github_connections.github_signal`, showcase, themes; [signal](supabase/migrations/20260907000001_github_signal.sql), [showcase](supabase/migrations/20260907000004_github_showcase.sql), [themes](supabase/migrations/20260910000001_github_showcase_themes.sql) | Supplementary task/tool evidence | Projects/expertise | Own skills evidence | Worker skill rows currently use repository languages, not complete framework/method extraction. README claims and repository ownership are not verified personal contribution. No stars/count/recency prestige bonus. |
| `cv_chunks` role/project/education/skills/summary, TSV and vectors; [indexes](supabase/migrations/20260908000003_vector_indexes.sql) | Evidence retrieval | Consented expertise retrieval | Evidence retrieval | Useful existing indexes, but generated chunks are not original source quotes. Current education/role chunks contain institution/employer text. Build safe purpose-specific projections; never pass whole chunks unchanged. |
| Job title, description, company, skill/sector joins; [initial schema](supabase/migrations/20260527000001_initial_schema.sql), [latest feed](supabase/migrations/20260917000018_listing_feeds_set_based.sql) | Approved requirements | Posted-role context only | JD side of comparison | Broad job-skill tags have no required/preferred distinction, alternative groups or proficiency/duration. Add confirmed, source-linked exact requirements (§3). Company/poster identity is app-side, not a prestige input. |
| Job `pay`, location type/text, start month/year, deadline; [expansion](supabase/migrations/20260528000014_opportunities_expansion.sql) | Explicit availability constraints | Usually not a person-matching signal | Practical preference compatibility | Pay/location text are not reliably numeric/geocoded. No job type, duration, precise start flexibility or structured pay period/currency today. Never compare annual to hourly pay as plain numbers. |
| Bookmarks and member-declared applied state; [bookmarks](supabase/migrations/20260530000005_opportunity_bookmarks.sql), [actions](supabase/migrations/20260531000005_user_listing_actions.sql) | Not hiring-outcome evidence | Excluded | Save/applied badges and explicit hide-applied filter | Applied is self-reported; apply-click is not submission. Do not reveal private application activity to recruiters or infer a capability/preference from clicks. |
| `open_to_connections`, connection/block/cooldown state; [connections](supabase/migrations/20260917000001_connections.sql), [latest directional cooldown](supabase/migrations/20260917000017_connections_directional_cooldown.sql) | Contact action eligibility | New-connection eligibility and UI state | Poster contact eligibility | Reuse live checks. No graph centrality, acceptance popularity or message contents in ranking. An accepted connection does not grant access to the other person's CV or AI memory. |
| Approval, committee status, listing revisions, source removal | Live access filters | Live access filters | Live access filters | Use latest definitions, pending edits stay private, and all changes invalidate dependent results. `jobs` is an ingestion work queue; actual job postings are `opportunities`. |

**Excluded sources:** identity/contact fields, OAuth tokens, raw CV blobs, upload tickets, email
logs/queues, moderation reports, connection notes/events and post likes/analytics are not fit
signals. Community posts are not silently mined into career/personality profiles. Private URLs
are neither model inputs nor permission for an arbitrary scraper. Grants/events stay outside the
job-finder/recruiter modes.

## 2. Specific skills: the missing contract

There are already **two taxonomies**, not one:

1. `skills` uses smallint IDs for directory/job category tags. Its migration puts `pytorch` and
   `tensorflow` under Deep learning, `sklearn` under Machine learning, and `aws/gcp/azure` under
   Cloud engineering. Keep this useful broad UI categorisation; do not invert it into specific facts.
2. `cv_skills` uses UUIDs for extracted-skill normalisation. Its seed is an external script/CSV,
   not a migration. The checked-in seed contains FastAPI/PyTorch/TensorFlow, but a migration replay
   does not prove that taxonomy is populated or production has identical contents. Pin a versioned
   seed manifest and test missing/partial taxonomy startup without reading production credentials.

`normalise_skills()` currently embeds each raw term, takes its nearest `cv_skills` row and accepts
similarity >=0.8 ([code](server/app/cv_pipeline.py)). `get_my_cv_profile()` displays the canonical
name where available and deduplicates it ([latest RPC](supabase/migrations/20260911000002_dedupe_cv_profile_skills.sql)).
This is not safe evidence of exact equivalence. Preserve raw terms and use a reviewed exact-alias
resolver first. Similarity may suggest a candidate mapping; it cannot certify “has PyTorch”.
Never rank on `member_skills.confidence` as if it were demonstrated expertise.

Add normalised skill assertions linked to immutable evidence:

`member → source/version/span → assertion(concept, raw term, type, polarity, modality,
evidence kind, task/contribution, dates where known, mapping status/version)`.

Types include language, framework/library, platform/tool, standard/protocol and specific method.
Keep exact identity, broader category and transferable relationship as distinct edges. Preserve
unmapped terms with safe lexical retrieval; a missing taxonomy row must not erase a real skill.
Resolve ambiguous acronyms from context or ask: GCP can describe cloud or clinical practice;
R/Go/C/C++/C# need dedicated token handling, not English stemming or substring matches. Versions
matter only when the JD explicitly needs them; unknown version remains unknown.

Specificity includes **RAG, fine-tuning, experimental techniques, valuation methods and lab/design
tools**, not just software packages. Current extraction instructions favour named technologies
and explicitly exclude some generic project concepts; RAG/method and nonsoftware coverage must be
tested and extended deliberately. A security project defending against SQL injection does not
automatically prove exploit expertise, but demonstrated authorised security testing must not be
lost by a blanket exclusion of security methods. Extract the task and evidence, not merely a word.

Distinguish used/built/taught, self-listed, learning/interested, explicitly negated and unclear.
“Would like to learn PyTorch” cannot satisfy “has used PyTorch”. Source-grounded role/project
technology links prevent applying one flat CV skill to every employment interval. Extend project
dates/role contribution and relevant credentials only when supported; missing dates are unknown.
Certifications need name and validity evidence when explicitly required, never an invented licence.

GitHub has a second loss point: [worker](server/app/worker.py) normalises `signal.languages` only;
frameworks may exist solely in selected README/summary text. The language collector excludes
Shell/HCL/YAML/Markdown. This must not become a global ban on demonstrated Bash/Terraform/config
engineering evidence. Extract permitted selected-project assertions with provenance once on
source refresh; no per-recruiter repository scan. All-account themes are leads, not proof that a
selected project or its owner used every inferred tool. Fork/organisation/private-repo contributions
may be missing from this owned-public-repo pipeline; offer self-entered, labelled project evidence
instead of treating missing public GitHub as lack of experience or widening OAuth scope silently.

## 3. Recruiter mode gaps and planned behaviour

- **Requirements preparation:** show poster/admin a compact JD requirements preview before matching.
  Each item records exact skill/task, required/preferred, AND/OR alternatives, minimum evidence or
  relevant duration, optional version and source span in the approved JD. Conflicts between tags,
  prose and structured fields require confirmation through the approval flow. A model cannot turn
  every tool mentioned in an employer's stack into a must-have or interpret “nice to have” as required.
- **Do not rewrite the job through chat:** a recruiter may narrow a search explicitly, but the UI
  distinguishes published job requirements from this search's additional preferences. Additional
  criteria cannot silently redefine published applicant eligibility or produce a public rejection.
- **Evidence matrix:** show criteria alongside Met / Not evidenced / Conflicting / Needs confirmation,
  specific supporting work and source age. Self-declared is labelled; extraction agreement is not
  independent credential verification. Candidate-owned correction/suppression must work before A1.
- **Experience/task fit:** use relevant tasks, contribution and supported duration; no unlimited
  reward for CV length, employer prestige, repeated keywords or decades of unrelated experience.
  Test a concise student project against a long keyword-heavy alumnus CV and equally against
  strong, directly relevant graduate evidence. Do not guarantee students win Both-audience jobs.
- **No hidden rejection engine:** distinguish candidates lacking mandatory evidence from candidates
  positively known not to meet a criterion. Offer an explicit possible-match/needs-confirmation
  view without claiming those requirements are met; do not silently discard uncertainty forever.
- **Saved findings:** keep the agreed seven days, fresh eligibility and budgeted rescans. Separate
  coverage from quality: “no new matches” requires completed coverage of the considered update
  range, not merely an exhausted top-20 assessment budget.
- **Authority:** posting ownership is current authorisation, not proof of employment or hiring
  authority. Keep job reporting/moderation. Recruiter teams, reassignment, bulk export and ATS
  integrations remain deferred rather than sharing confidential searches by company-name match.

## 4. Network mode gaps and planned behaviour

- Distinguish **shared interests**, **expert help**, **collaboration/cofounder** and **mentoring**
  intent within the existing Network mode. Keep chips/criteria visible; no need for four more agents.
  Similar profiles help shared-interest searches, while complementary skills help collaboration.
  Choose the goal explicitly rather than applying one similarity ranking to every interaction.
- Add optional structured **seeking/offering**, topics and availability-for-this-purpose. Existing
  ranked intents describe wants only. “Find a mentor in ML” needs willingness to mentor and relevant
  expertise; neither an alumni label nor someone seeking a mentor proves either.
- Preserve the deep-learning AND chess example with separate expertise/interest evidence. Hobbies
  in network matching cannot propagate into recruiter or job-ability scores through memory.
- Respect `open_to_connections`, bilateral blocks and cooldowns. Default Build your network to
  people open to new connections; exclude already-connected/pending targets by default with a
  labelled option to include existing contacts. This affects discovery/action scope, never a
  hidden quality penalty or disclosure of why someone declined/blocked another member.
- Network permissions do not grant contact details or private-intent disclosure. Display only
  permitted supporting labels; do not expose a confidential career transition as a match reason.
  Avoid exact private-filter counts that turn repeated queries into an inference oracle; approved
  positive matches still inherently disclose some match information, which belongs in consent UX.
- Sparse data needs a useful self-entered skill/project path and optional interests completion.
  The agent must say what it cannot establish rather than inventing hobbies from CV topics.

## 5. Find-opportunities gaps and planned behaviour

- Use the same approved requirement contract as the recruiter, so PyTorch evidence means the same
  thing in both directions. Keep **ability match**, **eligibility** and **personal preference fit**
  separate. A job can fit someone's skills but fail their desired schedule/pay; state that without
  changing the evidence score or claiming the candidate is less capable.
- Add an owner-only work-preferences record: role/employment type, preferred locations/remote
  scope, earliest start/flexibility, desired commitment and optional compensation preferences.
  These are voluntary explicit fields with confirmed-at/version and separate recruiter disclosure;
  do not copy them automatically from `current_focus` or infer them from CV home addresses.
- Expand job authoring before A3: role type, commitment/duration, start flexibility, structured
  location/remote region and optional pay range/currency/period. Retain original display text.
  Unknown pay or remote geography stays unknown; “remote” does not mean globally employable.
  Do not invent salary conversions, visa/sponsorship eligibility, citizenship or work authorisation.
  Any future formal work-authorisation flow needs its own necessity/access review.
- Show the exact JD criterion and candidate evidence, plus missing tools, transferable alternatives
  and requirement ambiguity. Keep Apply available for eligible jobs even with low/unknown fit;
  AI evidence scores do not establish employer acceptance or override posting eligibility.
- Honour bookmarks, self-reported Applied and explicit Not interested/Undo. Not interested is a
  member-owned discovery preference with a stated lifetime, not shared training data or recruiter
  feedback. Do not infer application success from an outbound click or connection acceptance.
- Compare dates with a documented opportunity timezone/date policy consistently in UI, SQL and
  worker. The current schema has a date-only deadline and month/year start; avoid false precision
  and midnight discrepancies. Refresh/source timestamps and closed-job suppression remain visible.
- “Posted by” is the poster; label a hiring-manager relationship only if separately collected.
  Applying and connecting remain independent actions with their own permissions.

## 6. Cross-cutting gaps found in migration history

**Privacy is not determined by whether a screen renders a field.**
[CV column locking](supabase/migrations/20260901000009_lock_cv_columns.sql) revokes table SELECT but
explicitly grants `current_focus`, venture fields, recruiting status, urgency and availability to
authenticated/anon roles; [profile RLS](supabase/migrations/20260527000002_rls_policies.sql) permits
approved members to read other approved profiles. The anon grant does not defeat RLS, but approved
members can query these scalar fields. Meanwhile interests/intents tables are owner/admin-only.
Do not describe all intake data as private. Before adding confidential preferences, use an
owner-only table and scoped RPCs; review/restrict existing scalar disclosure if that is the intended
product boundary, updating profile/intake reads and regression tests. Do not broaden RLS simply
to make AI retrieval easier. No claim that public disclosures have already been corrected.

**Graduation lifecycle currently conflicts with retaining graduates.** The latest
[admin_delete_graduates](supabase/migrations/20260917000009_admin_delete_graduates_never_deletes_caller.sql)
selects approved students with `grad_year <= cutoff`, deletes their postings and then their auth
accounts. It is reachable from the admin Graduate cleanup UI; this is a manual action, not an
observed scheduled deletion. A0 must reconcile it with the confirmed graduate-member product:
recommend retire the graduation-year bulk-delete workflow and replace it with status confirmation/
transition, preserving actual account-deletion rights. Do not auto-complete a degree on a date.
Audit the student email-domain/auth lifecycle too: graduation must not require losing the member's
identity, consent history or ownership and creating a duplicate account. No deletion or auth-policy
change was performed by this review; lifecycle design/secure email re-verification precedes rollout.

**Versioning must cover child rows and settings.** `profiles.profile_version` tracks intake form
completion, not a universal content revision. `member_skills` are delete/reinserted by source;
profile skill/sector/interest/intent junctions and GitHub showcase selections can change separately.
Add explicit source/purpose epochs and transactional invalidation for each mutation, direct
authorised writes, taxonomy mapping edits, consent, block/open-to-connection and job junction edits.
Do not base cache correctness on `profiles.updated_at` alone. Backfill existing rows in bounded
batches with coverage/version checks and worker fencing; missing safe data is a visible state.

**No-CV and current-source parity.** `get_my_cv_profile()` joins through a current CV; using it as
the AI's only profile source would omit GitHub-only alumni and manual evidence. Build purpose
projections directly from authorised current sources, not this self-display RPC. Existing remove
and disconnect functions clear current flags/skills or schedule summary repair; AI reads must
synchronously stop using the removed source even while recomputation is pending.

**Quality measurement must cover omissions, not just the ten displayed cards.** Add held-out
specific-skill/method and nonsoftware queries; label both retrieved and missed candidates/jobs;
separate exact-tool recall, requirement correctness, useful matches and inference privacy failures.
Track corrections and explicit optional feedback without using engagement as ability labels.
Use rollout flags and evaluated taxonomy/extraction versions; a broad seed or new embedding model
can change rankings even without an application-code change.

## 7. Priority and additional acceptance fixtures

| Stage | Required work beyond the earlier plan |
|---|---|
| A0 | Field-level access inventory; graduation/account transition design; explicit source epochs; exact-alias versus category contract; versioned seed and unmapped-term path; candidate preview/correction scope |
| A1 recruiter | Approved JD requirements review; source-linked role/project assertions; nonsoftware/method and no-CV evidence parity; Met/unknown/conflicting matrix; safe source removal and seven-day findings/rescan coverage |
| A2 network | Seek versus offer fields; network intent and complementary/shared-interest logic; privacy-aware academic/hobby projection; open/pending/connected states and no private counts |
| A3 opportunities | Work preferences separated from ability; richer job logistics; applied/bookmark/dismiss controls; consistent date handling and reciprocal requirement tests |

Fixtures must include:

- PyTorch versus TensorFlow under the same broad tag; FastAPI versus generic backend; sklearn alias
  equivalence; RAG versus generic LLM work; C/C++/C#, R/Go and ambiguous GCP; unknown tool/version.
- JD “PyTorch or TensorFlow required; FastAPI desirable”; employer-stack mention versus candidate
  requirement; inconsistent structured tags/prose; “learning”, “not used” and actual task evidence.
- Bash/Terraform demonstrated in a repo despite filtered language metadata; selected versus
  unselected repository evidence; GitHub-only/no-CV member; unavailable private/organisation work.
- Lab techniques, financial modelling methods and design tools; expired/unknown certification;
  spoken language versus programming language; overlapping role periods and undated projects.
- Seeking a mentor versus offering mentorship; skill similarity versus complementary project need;
  chess interest preserved across refinement and never imported into hiring criteria.
- Job skills met but preferred location/pay/start incompatible; hourly versus annual pay; remote
  with restricted region; deadline midnight; Already applied is self-reported; Apply stays human.
- Updating/deleting only a skill junction, interest, showcase or alias invalidates results; removed
  sources cannot survive in combined summaries; seven-day chat deletion does not delete consented
  profile evidence with its separate lifetime or preserve private chat-derived data via caching.
- Graduate transition preserves membership and job ownership; the legacy bulk-delete flow cannot
  be triggered as the transition; approved-member direct reads cannot expose newly private fields.

These are planned release tests. No application, provider or migration tests were run in this
documentation review.
