# 11 · Data Protection Impact Assessment — Foundry AI (search, matching, assessment)

Prepared under **Article 35, UK GDPR**, following the ICO's DPIA template structure.
**Controller:** IC Founders Ltd (Companies House 17171277) — see `02-ropa.md` §1.
**Assessed:** 11 November 2026.
**Status:** DRAFT for the controller's data protection contact and legal team. This is a factual,
code-grounded assessment, not legal advice, and not a substitute for their sign-off. **No AI mode
may be switched on in production before this document — or the controller's own DPIA, built from
it — is reviewed and signed off** (`docs/owner-decisions.md` item 19 / A0.2).

## Why this document exists, and why the other three DPIA screenings didn't need one

`07-dpia-screening.md` screens three earlier features — Community posts, Connections, CV-intake —
and concludes in each case that a full DPIA is **not** required, because none of them profile a
person or make any decision, automated or human, that turns on an automated evaluation of them.
That document's CV-intake screening says explicitly: *"This conclusion should be re-examined if the
deterministic matcher is ever replaced by an LLM"* — and Foundry AI is exactly that replacement,
for a different but related purpose (recruiter search rather than skill-chip suggestion).

Foundry AI is different in kind, not degree: it takes a candidate's profile and CV-derived
evidence, evaluates it against a job poster's stated criteria, and produces a **ranked, scored list**
that the job poster reads to decide who to approach. That is automated evaluation of personal
aspects of a person (their suitability for a role), feeding a decision with a real effect on their
opportunities, made by a human who sees the AI's output rather than the underlying evidence
directly. This is squarely the kind of processing Art. 35(3)(a) exists to catch.

## 1. Describe the processing

**Nature.** Three search modes, all built on the same pipeline:
- **Find candidates** (`recruiter` mode): a job poster describes criteria for a role; the system
  retrieves eligible members, evaluates each against the criteria, and returns a ranked,
  scored list.
- **Build your network** (`network` mode): a member describes who they're looking for; the system
  suggests other members who opted in to being found this way.
- **Find opportunities** (`jobs` mode, from the member's own side): a member's profile is matched
  against open roles.

**Scope.** Every approved member who has opted in (recruiter-discoverable and/or
network-discoverable; both **off by default** — `ai_private.member_settings`,
`supabase/migrations/20261006000003_ai_consent_and_projections.sql:28-32`). Evidence sources: the
member's profile fields (skills, sectors, course, "working on," interests/hobbies for network mode
only, "can help with" / "wants help with"), their CV (skills/projects/roles, only with explicit
consent — `evidence_sharing`, default `false`), and their chosen GitHub languages/repos if
connected. Never: name, email, photo, contact links, protected characteristics
(`frontend/src/app/ai-notice/page.tsx`, "What it uses").

**Context.** A voluntary membership community (Imperial students, graduates, alumni, mentors,
angel investors). Recruiters using "find candidates" are themselves members who posted an approved
job through the existing listing flow — not an external, unvetted third party.

**Purposes.** Helping job posters find relevant candidates faster than manual browsing; helping
members find relevant opportunities and people. Being *found* by another member (recruiter or
network search) is opt-in and off by default. A member's own job matches use their own profile
whether or not they choose to be found (`/ai-notice`, "Who can find you") — there the member is the
searcher, not the evaluated party, and the thing evaluated is a job listing.

### How the evaluation actually happens (the part Art. 35(3)(a) is about)

- The underlying AI model **never supplies a numeric score** and its claims about
  pre-defined "concept" criteria (e.g. a fixed skill tag) are **discarded entirely** — the model's
  only real contribution is judging *free-text* criteria (a recruiter's own wording) against the
  evidence, returning one of `met` / `unknown` / `not_evidenced` per criterion, grounded against
  the evidence actually present (`server/app/ai/pipeline.py` `Turn._bind`, L502-518; `score.py`
  docstring L1-6: "the model never supplies a score").
- **The ranking itself is deterministic, not model-driven**: `score_candidate()`
  (`server/app/ai/score.py` L172-228) computes a 0–100 integer from the per-criterion states, sorts
  by tier → exact-match count → score (`pipeline.py` L545, L618), and that ordering is what the job
  poster sees.
- **No automated contact, application, or rejection of any kind.** A deliberate grep across the AI
  module for any auto-contact/auto-apply/auto-message logic found none. The only payload returned
  to a job poster is a member id, score, tier, and per-criterion evidence references — never
  contact details (`pipeline.py` L540-544, L613-617). Reaching a suggested candidate requires the
  existing, separate Connections feature, which is its own opt-in, consent-based exchange
  (`07-dpia-screening.md`'s Connections screening).
- **The screen that runs before any of this**: `server/app/ai/policy.py` `screen(message, mode)`
  refuses queries naming age, disability, pregnancy, marital status, or similar in every mode
  (`_ALWAYS_SENSITIVE`), and refuses nationality/ethnicity/religion/sexuality/gender in recruiter
  and jobs mode — the **one exception** is network-building search, where these are allowed because
  no profile field exists to filter on them and the relationship is mutual-accept-only
  (`policy.py` L24-39, decision dated 2026-11-10). This is about *what a searcher can ask for*, not
  about how a candidate is evaluated once a legitimate search runs — kept distinct in this
  assessment on purpose.
- **Job-audience gating applies to candidate search too, not just a member's own job feed.** A
  job's `students`/`graduates`/`both` audience restricts who can even be *surfaced* as a candidate
  for it, confirmed in both directions (`ai_private.member_candidate_ok` →
  `member_in_audience(p_target, recruiter_audience(...))`,
  `supabase/migrations/20261006000004_ai_turns.sql:404-405`).

## 2. Consultation

⚠ **CONFIRM** — the controller's data protection contact should confirm whether member
consultation (e.g. a notice period, feedback channel, or sampling a few members' reactions to the
`/ai-notice` wording) is appropriate before launch, proportionate to a ~2,000-member voluntary
community. No consultation has been carried out as of this draft.

## 3. Necessity and proportionality

- **Is this processing necessary for the stated purpose?** Matching members and job posters at
  scale without some form of automated evaluation isn't feasible once the membership and job
  volume exceed what manual browsing can cover — this is the same proportionality argument that
  justified the (screened-out) deterministic CV-skill matcher, extended to free-text criteria a
  fixed vocabulary can't express.
- **Could it be done with less data, or less automated evaluation?** Two design choices already
  narrow this: (a) protected characteristics are excluded from the evidence entirely rather than
  included-but-downweighted (`/ai-notice`, "What it uses") — with one limit, stated in the risk
  table: free text a member wrote about themselves (`bio_hobbies` in network mode) can mention one,
  which is why searches *for* Art 9 categories are refused in every mode; (b) the model judges only free-text
  criteria, never concept criteria, which keeps the one part of the pipeline that could introduce
  model bias to the smallest possible surface. A simpler keyword/concept-only matcher (no free-text
  judgement at all) was considered, implicitly, as the status quo this feature replaces — rejected
  as the reason the feature exists: recruiters write criteria in their own words, and a literal
  keyword matcher cannot assess "led a small engineering team" against "founded and grew a
  three-person dev team," which is exactly the paraphrase gap `assess_quality`'s eval suite is
  built to catch (`server/evals/datasets/assess_quality.jsonl`, family `assess-paraphrase`).
- **Is the evaluation accurate and non-discriminatory?** This is being tested, not assumed:
  `assess_quality` includes a dedicated fairness family (`assess-fairness`) asserting the *same*
  state/task/depth outcome across two candidates whose substantive evidence is identical and who
  differ only in incidental, demographic-coded filler text — and the assessor prompt
  (`server/app/ai/prompts/assess.txt`) has an explicit instruction not to infer or weigh protected
  traits from wording. A live-model run of this suite (not just the offline fake-provider pass) is
  listed as a pre-launch step (`docs/owner-decisions.md` item 23) and should be re-run periodically,
  not treated as a one-time gate.

## 4. Risks identified, and what mitigates them

| Risk | Mitigation |
|---|---|
| The AI infers or acts on a protected characteristic it was never meant to see | The profile has no field for any protected characteristic, so none is sent as structured data. Free text a member wrote can still mention one (network mode uses `bio_hobbies`), so this is **not** excluded by construction. The second layer carries the weight: the pre-model screen, the database's `is_sensitive()` and the interpreter prompt refuse searches on ethnicity/race, religion and sexuality (**Art 9 special categories**) in every mode, and on every protected characteristic in recruiter/opportunities mode. Network mode alone allows gender and nationality, which are not Art 9 categories (`policy.py` `_SPECIAL_CATEGORY` / `_AFFINITY`, migration 20261112000001). The 10 Nov carve-out that also allowed Art 9 categories in network mode was withdrawn on 12 Nov: a search on them works only by inferring them from members' text, and the network toggle is not an explicit Art 9(2)(a) consent ([12](./12-uk-legal-gap-analysis.md) §2.3) |
| A candidate is scored down by filler/incidental details unrelated to the actual criteria (indirect discrimination via proxy) | `assess-fairness` eval family exists specifically to catch this; the assessor prompt instructs against it; **residual risk**: this is evaluated by sample eval cases, not a mathematical guarantee, and should be monitored on an ongoing basis once live, not just at the pre-launch gate |
| Model hallucinates a "met" verdict from no real evidence | `Turn._bind` demotes any claimed "met" with no supporting evidence reference to "unknown" server-side — the model's unsupported claim is structurally incapable of reaching the job poster (`pipeline.py` L514-515) |
| A prompt-injection attempt inside a candidate's own profile/CV text manipulates the assessor into a false "met" for every criterion | `_INJECTION` phrase detection in the policy screen, plus the grounding defense above, plus a dedicated adversarial eval suite (`adversarial_assess`, `score_assess` in `server/evals/harness.py`) that exists specifically to test this attack and is unrelated to model quality |
| Being excluded from a recruiter's results (because of an opt-out, or a true-negative evaluation) is treated as a judgement about the person, if the output is misread | `/ai-notice`: "Something missing from a profile isn't the same as someone lacking it" — results explicitly separate "not shown" from "doesn't meet," and nothing is phrased as a rejection or a rating of the person |
| Job poster re-identifies a candidate's protected characteristic from an evidence excerpt even though it wasn't a search criterion | Not separately mitigated beyond the general exclusion of protected-characteristic evidence from the pipeline; ⚠ **CONFIRM with data protection lead** whether the ≤2 CV-excerpt lines shown to recruiters (gated by `evidence_sharing` consent) need an additional review step before this is considered closed |
| CV/profile data retained indefinitely, growing the blast radius of a future breach | 7-day retention on chats/criteria/results and saved matches, 30-day cap on cached evidence checks, both enforced by an hourly cron (`cron_purge()`, `supabase/migrations/20261006000004_ai_turns.sql:2179, 2192, 2208`) — not a policy on paper, a scheduled deletion |
| Runaway spend turns into a de facto denial-of-service on the feature, or masks a bug that's sending more data than intended | Hard-capped at $5/day (matching), $0.50/day per member, 20 active turns, with an admin-only kill switch that is itself audit-logged (`ai_private.settings`, `supabase/migrations/20261006000001_ai_foundations.sql:106-116`; kill switch `app_config.ai_enabled`, audited via `admin_actions` on every flip) |
| A member who opted in to being found later wants out, and stale results linger | Withdrawing `recruiter_discoverable` / `network_discoverable` / `evidence_sharing` deletes that purpose's projection and cached assessments in the same transaction (migration header, `20261006000003_ai_consent_and_projections.sql:5-10`) — not just a future-search exclusion |
| A candidate outside a job's intended audience (student-only or graduate-only role) is still surfaced to the recruiter | Confirmed enforced in the candidate-search direction, not just the member's-own-feed direction (§1 above) |

## 5. Art. 22 — is this solely automated decision-making with legal/significant effect?

> **DUAA 2025 note (12 Nov 2026).** Since 5 Feb 2026, Art 22 UK GDPR has been replaced by
> Arts 22A–22D (Data (Use and Access) Act 2025, s.80). A significant decision based solely on
> automated processing is now allowed with safeguards (Art 22C: tell the person, let them make
> representations, obtain human intervention and contest it), and is restricted only where special
> category data is used (Art 22B). The conclusion below (not solely automated, and not a
> significant decision) is unchanged under the new test. If either fact changes, the Art 22C
> safeguards apply. Read references to "Art. 22(3)" as Art 22C.

**No**, on the facts above, but the reasoning matters more than the "no," so it is stated in full
rather than asserted:

- The output is a ranked list of suggestions. A **human** (the job poster) decides whether to act
  on any of it, and acting on it means using the separate Connections feature — a distinct,
  consent-gated step that requires the recipient to accept before any contact detail changes hands.
- Nobody is rejected, filtered out of the job's visibility, or denied anything by Foundry AI
  itself. A candidate who scores poorly, or is absent from the list entirely, is not told anything,
  is not blocked from applying through any other channel the platform offers, and suffers no
  automatic consequence.
- This conclusion is **more contestable than the equivalent conclusion for Connections' sending
  throttle** (`02-ropa.md` item R), because here the automated output is the *primary artefact* a
  recruiter reads, rather than one input among many a human was already going to consider. That is
  exactly why Art. 35(3)(a)'s *profiling* limb is treated as engaged above (triggering this DPIA)
  even though the stricter Art. 22 *solely automated decision* limb is assessed as not met. These
  are different legal tests and this document does not conflate them.

**Re-assess this section if**: the ranking is ever used to auto-filter who a job poster can even
see (today, nothing is hidden — only reordered); a rejection, auto-reply, or auto-application is
ever added; or the scoring is ever surfaced to the *candidate* in a way that reads as a verdict
rather than an explanation of what the recruiter saw.

## 6. Open points for the data protection lead

1. **Is a full external DPIA still required, given this internal assessment?** This document is
   built to the ICO's structure and grounded in the live code, but it is not independent legal
   advice. The controller should confirm whether this, once reviewed, satisfies the Art. 35
   obligation, or whether external counsel or the data protection lead sign-off needs to produce its own version.
2. **The CV-excerpt re-identification risk** (§4, table row 6) — whether the ≤2-line excerpt shown
   to recruiters needs a further safeguard beyond the existing consent gate.
3. **Whether prior Information Commissioner consultation (Art. 36) is triggered.** On the mitigations
   above, residual risk is assessed as not "high" after mitigation, so Art. 36 consultation is not
   expected to be required — but this is the data protection lead's call, not an engineering one.
4. **Monitoring cadence for the fairness eval**, not just a one-time pre-launch pass — e.g. re-run
   `assess_quality --live` on a schedule (quarterly, or after any prompt/model change) and keep the
   results somewhere the data protection lead can see them.

## 7. Related duties

Distinct from this DPIA: the recruiter-matching feature is not itself a user-to-user communication
channel (unlike Community/Connections), so the Online Safety Act illegal-content duties in
`09-osa-illegal-content-risk-assessment.md` are not engaged by Foundry AI directly — only by the
Connections step a job poster might take afterward, which that document already covers.

## 8. Re-run or extend this DPIA if

- a numeric score or ranking signal is ever shown directly to the evaluated candidate, rather than
  only to the searcher;
- any result is used to automatically filter (hide, not just reorder) who a recruiter can see;
- the model is given access to a protected characteristic, directly or via a proxy field, as an
  evidence source;
- automated contact, application, or messaging is added to any mode;
- the free-text criteria judgement is extended to weigh concept criteria too (today concept state
  is deterministic and ignores the model entirely);
- membership, or the number of jobs posted per month, grows by an order of magnitude;
- the fairness eval family is removed, weakened, or stops being run before each prompt change.
