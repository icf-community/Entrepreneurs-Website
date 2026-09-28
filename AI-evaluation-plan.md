# Foundry AI custom evaluation harness — implementation contract

Required by the owner, 2026-09-26. This is the design for a **custom, objective-based harness**,
not an implemented runner or a passing evaluation report. Build it before enabling recruiter
matching, then extend it for Network and Find opportunities. See [AI-plan.md](AI-plan.md) and
the [migration/data audit](AI-data-audit.md). Product controls remain deterministic wherever possible.

## 1. What the harness measures

The objective is correct, authorised, useful matching at bounded cost across the whole pipeline.
A schema-valid model response is necessary but insufficient. Evaluate extraction, interpretation,
retrieval, evidence assessment, deterministic scoring, memory and publication separately, then
test their composition. A model grader's approval cannot override a failed security assertion.

OpenAI's guidance recommends defining objectives, datasets and metrics, evaluating continuously,
and calibrating automated judging against human review. Those principles inform this design;
the Foundry objectives, fixtures and thresholds below are project-specific proposals.
[Official evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

| ID | Objective | Oracle / metric | Provisional release gate |
|---|---|---|---|
| O01 | Admit only relevant operations, preserving usable requests | Labelled allow/clarify/refuse decisions; safe SearchSpec equivalence; confusion matrix by mode/language | >=95% supported benign-intent handling; all curated off-domain/mixed-request safety invariants pass; report false acceptance/refusal separately |
| O02 | Preserve meaning across chat | Independently labelled AND/OR/NOT, required/preferred, replacement, negation, references and conflicts | 100% critical invariant fixtures; >=95% full-spec semantic accuracy on varied benign cases |
| O03 | Recover exact tools and broader capabilities correctly | Human-labelled source assertions, exact-alias tests, polarity/modality and evidence references | No false exact equivalence in curated critical cases; report assertion precision/recall separately for exact tools, methods and broad categories; initial target >=95% for each supported slice |
| O04 | Retrieve relevant eligible candidates/jobs before reranking | Independent labelled relevant sets, recall@200 and recall@20; exact-skill and sparse-data slices | Initial macro recall@200 >=95%; report assessor-cutoff loss and per-slice counts; no hard-required candidate loss hidden by a good overall average |
| O05 | Rank by the declared rubric | Human-adjudicated relevance grades, nDCG@10, pairwise constraints, fixed-score arithmetic cases | Initial nDCG@10 >=.80; all exact-required/tool-preference and anti-double-count fixtures pass; disclose tie rules and uncertainty |
| O06 | Ground evidence without overclaiming | Labelled source entailment/support, role/project attribution, dates and unknown state | Zero fabricated references/unauthorised quotes in the suite; initial supported-claim precision >=98%; unknown never asserted as confirmed absence |
| O07 | Enforce privacy/eligibility at every stage | SQL/RPC/access tests plus intercepted outbound requests and result hydration | Zero failures in mandatory suite, including mid-turn withdrawal, blocks, source removal and new private-field grants |
| O08 | Respect money, requests and resources | Shared DB invariants, transport spy, fault injection and actual process concurrency | Zero unreserved provider calls, ledger overruns or tested quota bypasses; explicit bounds hold at each configured limit |
| O09 | Retrieve memory and forget it correctly | Gold source IDs/criteria, source coverage and fake-clock event sequences | All pinned valid criteria and curated historical references preserved; seven-day/deletion isolation invariants pass, including derived state and late workers |
| O10 | Refresh saved findings without stale or duplicate work | Ready-feed fixtures, cursor/retry coverage, fresh-baseline comparison and provider-call counts | No skipped committed interval, stale publication or duplicate paid run; unchanged-data check makes zero provider calls; seven-day saved-findings expiry holds |
| O11 | Match the actual purpose | Mode-specific labels: sought/offered help, shared/complementary interests, job ability versus preferences | All curated mode-boundary fixtures pass; report useful-match quality separately for each purpose, never one aggregate hiding a broken mode |
| O12 | Operate at acceptable cost/latency | Cold/warm/change/no-change runs, monetary ledger and independent observed usage | Plan §14 latency/load targets tested with stated hardware, reported separately for no-provider-call paths (p95 < 2 s), cached natural-language turns (provisional p95 < 6 s) and uncached turns (p95 < 15 s) (F4); agreed budgets enforced; report cost per useful match and unsuccessful attempt, including background/grader spend |

These are initial gates to preregister and review against label quality before tuning. A held-out
failure is not permission to lower a gate after seeing the answer. Small samples and zero observed
violations are not proof of universal model safety. Report denominators and confidence intervals;
critical safety violations fail the run regardless of average quality. For noncritical quality
metrics report uncertainty and baseline deltas, not a single misleading “AI quality: 97%”.

## 2. Harness architecture and run modes

Implement a small Python package under `server/evals/` using the existing test environment,
with versioned schemas, datasets, adapters, objective scorers and reporting. Do not replace the
product with a toy pipeline just to obtain green evals. Reuse the real validated pipeline through
dependency injection for clock, provider transport, persistence and source corpus.

Planned components (paths are future deliverables):

- `schemas.py`: strict case/run/result schemas with fixture version, objectives and oracle references.
- `datasets/`: immutable synthetic JSONL cases plus normalised fixture corpus, family/split manifests
  and human annotation rubric. Source refs include spans and timestamps; all IDs are synthetic.
- `adapters/`: production stage calls, end-to-end service calls, deterministic fake provider,
  recorded synthetic-output replay and explicitly enabled bounded live OpenAI calls.
- `scorers/`: independent expected-state/ranking checks, retrieval metrics, grounding checks,
  invariant assertions, paired deltas and optional calibrated model-grader adapter.
- `runner.py`: mode/suite selection, seeded ordering, independent repetitions, resume identity,
  timeout/concurrency/budget reservation and fail-closed configuration.
- `reports/`: JSON and readable HTML/Markdown with objective/slice metrics, errors, skipped cases,
  confidence intervals, model/prompt/taxonomy/rubric versions, costs and baseline comparison.

| Mode | Runs | What it does not establish |
|---|---|---|
| Offline contract | Golden model outputs, malicious outputs, parser/scorer fixtures, source mapping and arithmetic | Real model quality or production latency |
| Local integration | Real local migrations/RLS/RPCs, workers and multiple processes; mocked transport, fake clock/failures | Provider behaviour or actual hosted capacity |
| Replay regression | Recorded synthetic model outputs through new validators/scorers/policies | Quality of a newly changed model/prompt; old recordings must not stand in for new sampling |
| Live model evaluation | Explicitly selected models/stages on synthetic/minimised labelled cases with hard eval spend cap | Load/abuse safety under production traffic; no production user transcripts |
| Staging release rehearsal | Synthetic end-to-end deployment with live controls and separately bounded smoke calls | Universal safety; no real-member adversarial testing or automatic rollout |

Default command behaviour must be offline, with no network and no implicit environment-file load.
Live mode requires explicit provider enablement, model snapshot, dataset, maximum cases and total
spend ceiling. Missing prices/caps or an unknown endpoint stop execution. Fail/skipped/error are
distinct report states; a run with mandatory suites skipped cannot be marked passed.

## 3. Case format and independently labelled expectations

Each case records: stable ID; objective IDs; mode/stage; family and split; source/schema/taxonomy
versions; synthetic actor and consent/eligibility state; corpus reference; clock; conversation/
criteria and event sequence; expected spec/decision; relevant IDs with relevance grades; required
pairwise ordering/invariant assertions; authorised evidence IDs; forbidden fields/actions; maximum
logical/provider calls; expected usage state; annotation provenance and uncertainty.

Illustrative complete **scoring-stage** case (the harness implementation defines the final schema):

```json
{
  "id": "recruiter-broad-and-specific-001",
  "fixture_version": 1,
  "objectives": ["O03", "O05"],
  "mode": "recruiter",
  "stage": "score",
  "split": "development",
  "family": "deep-learning-tool-preference",
  "clock": "2026-09-26T12:00:00Z",
  "criteria": [
    {"id": "g1", "concept": "deep_learning", "kind": "capability", "required": false, "coverage_points": 20},
    {"id": "t1", "concept": "pytorch", "kind": "tool", "required": false, "coverage_points": 40}
  ],
  "candidates": [
    {"id": "candidate_a", "eligible": true, "supported_criteria": ["g1", "t1"], "task_fraction": 0.8, "depth_fraction": 0.6},
    {"id": "candidate_b", "eligible": true, "supported_criteria": ["g1"], "related_tools": ["tensorflow"], "task_fraction": 0.8, "depth_fraction": 0.6}
  ],
  "transferable_credit": false,
  "expected": {
    "coverage_points": {"candidate_a": 60, "candidate_b": 20},
    "scores": {"candidate_a": 89, "candidate_b": 49},
    "order": ["candidate_a", "candidate_b"],
    "maximum_provider_calls": 0
  },
  "label_provenance": "Hand-calculated rubric fixture; task/depth inputs fixed, not model-judged"
}
```

Companion cases make PyTorch required (B cannot be published as a qualified match), change to
PyTorch OR TensorFlow (both may qualify), remove the specific requirement (broad-only search
does not penalise a tool choice), and add a duplicate taxonomy ancestor (no score change).
This arithmetic fixture is only a deterministic contract test. Separate raw CV/JD cases need
independent human labels for extraction and task/depth evidence; never generate every expected
score using the same implementation being tested.

## 4. Dataset coverage and split discipline

Start with at least 20 labelled jobs, 20 network searches across shared-interest/help/mentoring/
collaboration goals, and 20 distinct job-seeker preference profiles as a minimum smoke/development
set—not as sufficient evidence for a production quality claim. Before held-out release evaluation,
pre-register a sample-size plan based on the desired confidence-interval width and expected failure
rate, with adequate independent examples for every mode and high-risk slice (including exact-tool,
no-CV/sparse evidence, affiliation/eligibility, and seek-versus-offer). If data is too sparse for a
slice, report the uncertainty and do not claim that its target is met. Include 2k/10k synthetic
retrieval corpora with planted relevant records and realistic hard negatives. Add at least 150
adversarial cases plus a separate benign set; publish unique family counts rather than inflating
coverage with tiny paraphrases. These build on, rather than replace, plan §14's test requirements.

Include student, enrolled graduate, graduate faculty, mentor/angel, unknown education status,
no-CV, no-GitHub and self-reported evidence cases. Cover software, ML, hardware, lab/clinical
research, design, finance and commercial work. Use synthetic attributes for cohort tests; do not
collect real protected traits casually for an eval. Explicitly label scope/unknown policies.

Split by **source family/person/job/template**, not random rows: variants of the same CV/JD/chat
stay together. Keep development, validation and locked held-out sets; record hashes and prevent
training/prompt examples from including held-out answers. Model-generated cases need human checks;
the generating model's answer is not ground truth. Cases derived later from user feedback require
separate permission/minimisation and must respect source expiry, rather than retaining production
chats indefinitely under an “eval data” label.

Have two human/domain reviewers independently label the critical ranking/grounding calibration
subset and adjudicate disagreements; record ambiguous cases as such. This is a future annotation
workflow, not a request to spawn reviewer agents. Invalid/ambiguous ground truth must be repaired
before comparing models. Evaluate on identical input/source versions and separate corpus snapshots.

## 5. Required transformations and behavioural tests

Apply these transformations to labelled cases; each has an expected property, not necessarily
an identical score:

- Paraphrase without changing semantics: same validated requirements and materially same ranking.
- Add irrelevant résumé text, repeated tools or duplicate GitHub/CV evidence: no artificial score gain.
- Add a broad ancestor label: no double-count; supported independent broad task can contribute.
- Replace PyTorch with TensorFlow: exact PyTorch state changes; broader supported ML work may remain.
- Add “not used” or “learning”: exact demonstrated-skill assertion disappears or becomes unknown.
- Swap cohort/name/avatar while preserving legitimate eligibility and evidence: ability score stays
  fixed; a valid change to educational eligibility can change the eligible pool.
- Tighten a required criterion: no previously failing record becomes a qualified match merely due
  to pool renormalisation. Loosening may widen retrieval, but cannot silently change past scores.
- Add an unrelated candidate: unchanged candidate evidence score stays fixed; top-k may change only
  when a genuinely better eligible record was added. Account for bounded retrieval separately.
- Add chess in a network follow-up: preserve prior valid expertise constraint; switching to another
  job/mode cannot silently import chess. Expire the source: no surviving summary/criterion bypass.
- Withdraw consent/change a JD during execution: publication uses current rules or aborts safely.
- Rescan with no ready changes: zero provider calls; new/updated/opted-in eligible records can be
  considered without rerating all unchanged members or missing late-ready events.
- Replay/race/cancel/misconfigure limits: measured admissions and money remain bounded, including
  evaluator/grader calls in live eval mode. Use the full abuse matrix in plan §14.1.

## 6. Model grading and calibration

Use deterministic code for schema, IDs, eligibility, rates, arithmetic, exact required predicates,
expiry and provenance existence. Use human labels for substantive source interpretation. Optional
LLM graders can assess whether selected source spans support a specific task claim or compare two
interpretations against a detailed rubric, where simple string equality is insufficient.

Model graders output a constrained label, source IDs and short evidence rationale—not hidden
reasoning traces or a free-form global quality score. Pin grader model/prompt/schema independently
from the model under test. Blind model names and randomise pair order, test verbosity/position
bias, include adversarial instructions in graded text and recheck grounding. Graders have no tools
and only the minimised authorised fixture. Their API calls consume the eval budget as well.

Calibrate against an adjudicated human subset: confusion matrix, disagreement by objective,
false acceptance of unsupported claims and inter-reviewer agreement. Initial target >=90% label
agreement with no missed critical seeded failures; if inadequate, use human review for that metric
rather than describing the grader as objective. Same-family judges may share mistakes; disagreement
and spot checks remain necessary. Objective-based means measurable task criteria, not infallible
judgment. A grader may not turn a failing deterministic invariant into a pass.

## 7. Repetition, economics and release reporting

Sample critical live-model cases at least three independent times within the explicit budget;
report pass frequency and variance, not best-of-three. Pin supported model parameters; a random
seed is not a guarantee of provider determinism. If budget permits only a subset, record coverage
and leave the full release gate incomplete. Resuming a run cannot duplicate charged requests;
unknown provider completion retains its conservative reservation.

Compare broad-only, exact-lexical, existing bounded-spec, proposed broad+specific and graph-assisted
variants on the same labelled set. Ablate the broad term and exact term to establish what improves
useful-match quality and total cost. **Clustering is an optional ablation, not a planned component
(AI-plan §5.1, F10):** v1 retrieves memory by source-span keyword + vector search; an SLM-clustering
variant is built and compared only if O09 shows retrieval misses on the v1 path, and ships only if
it measurably improves useful matches net of its cost. Count interpreter, moderation, embeddings,
assessment, graph work, retries and graders. Report cold/warm/changed/unchanged conditions separately.

Each release report includes objective and slice denominators, all failures, baseline deltas,
confidence intervals (for example Wilson intervals for proportions and query-level paired
bootstrap for ranking metrics), uncertainty, costs, latency and trace IDs. Never persist private
production payloads in CI artifacts. Baseline promotion requires reviewed passing mandatory suites;
do not regenerate expected answers automatically from the changed model.

Run offline contract/integration suites in normal CI. Run cost-capped live-model suites explicitly
before releasing changes to model, prompt, parser, taxonomy, embeddings, rubric, evidence policy
or retrieval. Judge-only changes require calibration again. Ongoing production monitoring uses
minimised aggregate signals; it supplements the harness and honours seven-day chat/findings expiry.

**Browser layer.** Service adapters do not see what members see. Rendering of eligibility,
score labels, refusals, empty/limit states and the network assertions (no criteria in URLs,
no browser calls to ACA/OpenAI, one poll in flight) is checked by the AI-plan §14.4 Playwright
audit, not by this harness; a release needs both.

**Run records and comparison (programme Part G9).** Harness runs record per-stage spans in the same
metadata-only shape as production traces (model snapshot, prompt content hash, tokens, cost,
latency, outcome). `evals compare <runA> <runB>` prints per-objective and per-slice deltas between
two runs. No third-party tracing service is used; nothing leaves our infrastructure.

## 8. Deliverable and completion checklist

- Versioned case/corpus schemas, human annotation rubric and split manifests.
- Real pipeline adapters plus fault-capable provider spy, fake clock and real local DB fixtures.
- Objective scorers and regression cases, including broad+specific scoring and all source-audit gaps.
- Default-offline CLI, explicit cost-capped live mode and replay/version checks.
- Machine-readable and readable reports with missing-suite/failure exit codes.
- Human-calibrated model graders only where useful; held-out repeated release report.
- Integration with rollout gates; no model/weight choice justified solely by anecdotes.

Current status: specification written; harness code, labelled dataset and execution reports remain
to be built. No paid evaluation or model-behaviour validation was performed in this review.
