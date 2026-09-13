# B2.8 — CV/GitHub ingestion pipeline load test findings

**Run:** 2026-09-12 · **Corpus:** 500 synthetic `github_connections` + `scan_github` jobs,
seeded locally (repo counts: ~90% light at 5-30 repos, ~10% heavy tail at 100-300, matching
B2.6's own worst-case shape) · **Harness:** `server/scripts/b28_load_test.py`

---

## What was measured, and what these numbers are worth

Real `python -m app.worker` subprocesses, real local Postgres, real `for update skip locked`
contention, real subprocess startup/shutdown and signal handling. Two things were deliberately
stubbed, and only these two:

- **GitHub's HTTP API** — a local mock server (`b28_load_test.py`'s `_MockGithubHandler`)
  serves synthetic repo listings/READMEs, keyed by a per-connection bearer token. Reached via
  `GITHUB_API_BASE`, a one-line, default-unchanged override added to `app/github_pipeline.py`
  for exactly this harness.
- **OpenAI** — `OPENAI_STUB_LATENCY_SECONDS=1.2` (`app/openai_client.py`) sleeps a fixed
  duration and returns a canned, schema-conformant, fail-open response instead of calling the
  real API. 1.2s is not arbitrary: it is the C1 audit's own *measured* real-world average
  OpenAI latency (157s / 132 real calls). That constant is identical across every run in this
  document, so the *comparisons* below are honest even though no run measured real OpenAI
  concurrency.

**What this does NOT measure, stated plainly:** real OpenAI/GitHub API behaviour under genuine
concurrent production load. A stubbed call can't reveal a real rate limit, a real latency
spike under provider-side load, or real network variance. That gap is a post-launch monitoring
concern, not something a local harness can close — see the production runbook's monitoring
section once this ships.

---

## Finding 0 — A real bug in the test harness itself, worth recording

**Severity: methodology, not product** — but it produced a false "28/30 connections failed"
result that would have been reported as a genuine finding had it gone unchecked.

The first two 500-... no, the first *smaller* runs (1 and 30 synthetic connections) showed a
majority of connections ending `scan_status = 'failed'` with `"GitHub token is invalid or was
revoked"`, despite the mock server's own log confirming it had recognised every token it
actually received. Root cause: a **days-old orphaned `python -m app.worker` process**, started
at some earlier point per `server/README.md`'s own local-dev instructions and never stopped,
was still polling the same local `jobs` table. Because `for update skip locked` makes multiple
worker processes cooperate rather than error, it silently raced the harness's own spawned
instances for the same synthetic rows — when it won a claim, it called the *real*
`github.com` with the harness's fake bearer token and got a genuine 401.

**Why this is worth a line in the findings and not just a debugging footnote:** it is a clean
demonstration of exactly the property B2.8 exists to test — `for update skip locked` correctly
prevents two workers from double-processing the *same* row, but says nothing about two workers
being pointed at *inconsistent world state* (one real, one mocked). Any future load test against
this table must first confirm no other worker process is live. Fixed by killing the orphaned
process; all runs below were confirmed clean afterward via `scan_outcome_counts` (a dedicated
check added specifically because a job's `status = 'done'` proves the queue processed it without
raising, and nothing more — a caught `GithubScanError` still leaves a job looking clean at the
queue level while the underlying scan silently failed).

---

## Finding 1 — Near-perfect linear scaling, 1 vs 3 instances

| Instances | Jobs | Wall clock | Outcome |
|---|---|---|---|
| 1 | 500 | **1891.0s** (~31.5 min) | 500/500 `done`, 500/500 `scan_status = 'ready'`, 0 dead-lettered |
| 3 | 500 | **629.9s** (~10.5 min) | 500/500 `done`, 500/500 `scan_status = 'ready'`, 0 dead-lettered |

**3.00x speedup for 3x the worker count.** This is close to the theoretical ceiling — it means
the queue's claim/dispatch path (`for update skip locked`, one job at a time per process) adds
negligible per-instance overhead at this scale, and the bottleneck really is the per-job
LLM-call time it's standing in for, not database contention. No job was double-claimed, no job
was left stuck in `running` after either run, and every single one of the 500 synthetic
connections reached `scan_status = 'ready'` in both configurations — zero silent failures,
confirmed via `scan_outcome_counts`, not assumed from the job queue's own `done` count.

A second 3-instance run was also taken with a mid-run `SIGTERM` on one instance at t=20s (see
Finding 2) — it measured 913.0s, a 2.07x speedup. That is **not** a contradiction: killing one
of three instances 20 seconds into a 630-900-second run means the run was genuinely closer to
"3 instances for 20s, then 2 for the rest" — and 2.07x from an effectively-2-instance run is
itself close to that configuration's own ideal (2.0x), corroborating rather than undermining the
clean 3.00x figure above. The two numbers were kept separate deliberately rather than averaged,
since conflating a throughput measurement with a fault-injection measurement in one run is
exactly the mistake worth avoiding here.

**Re-run at 5 instances (2026-09-12, requested directly rather than assumed from theory):**
500/500 done in 387.0s — a 4.89x speedup over 1 instance (97.8% of theoretical-linear), and
1.63x over the 3-instance run for 1.67x more workers. **The queue/DB mechanics show no sign of
strain even at 5 concurrent instances** — this VM's real headroom extends past 3.

This does **not** change the launch recommendation below, and it's worth being precise about
why not: this number says something true about *this harness's* bottleneck (there isn't one yet,
mechanically) and says nothing new about the real constraint that would actually matter at 5
concurrent instances — OpenAI's own account-wide rate limit — because the harness's OpenAI calls
are a fixed-latency stub that always succeeds regardless of concurrency, by design (see the top
of this document). A clean 5-instance run is evidence the infrastructure could absorb more
*if real demand and a checked rate-limit ceiling ever justified it* — it is not evidence that
running 5 today is either necessary or verified-safe against the one bottleneck this harness
cannot see.

---

## Finding 2 — Graceful SIGTERM drain: confirmed clean

From the mid-run-kill 3-instance run: one instance was sent `SIGTERM` 20 seconds in, while
actively competing for jobs. Its log showed the expected sequence —
`received signal 15, finishing current job then exiting` followed by `worker stopped cleanly`
— and the run's final tally still showed 500/500 `done`, 0 stuck in `running`, 0 dead-lettered.
A deploy or `docker stop` mid-queue-drain does not strand or lose work, confirmed under real
concurrent load, not just at idle.

---

## Finding 3 — `reap_stalled_jobs()`: confirmed correct, via two combined checks

Neither check alone tells the full story, so both were run together (`b28_load_test.py
reap-test`):

1. **A genuine `SIGKILL`** (disorderly death, no graceful drain) really does strand a claimed
   job in `running` with zero automatic recovery — confirmed immediately after the kill, before
   the reaper ever ran. This is the failure mode the reaper exists for, proven real rather than
   assumed.
2. **`reap_stalled_jobs()`'s 15-minute threshold is correctly enforced**, checked via a row
   inserted directly with a backdated `updated_at` (16 minutes old) — `jobs_set_updated_at` only
   fires on `UPDATE`, so a direct `INSERT` is the one way to get a genuinely-old timestamp
   without waiting 15 real minutes. Calling `reap_stalled_jobs()` reclaimed the 16-minute-old row
   (→ `pending`) while correctly leaving the *seconds-old* genuinely-SIGKILL-stranded row from
   check 1 untouched (still `running`) — the right behaviour for a job that might still be
   legitimately mid-flight.

**REAP_TEST_PASS.** Both the failure mode and its recovery threshold are real, not
hypothetical.

---

## Recommendation: worker instance count at launch

Given real production scale today (society membership, not 500 simultaneous GitHub connects)
and a confirmed, clean, near-linear scaling curve with zero errors even at this harness's
worst-case load: **`foundry-worker@1` is sufficient to launch with.** The infrastructure and
code need no change to add `foundry-worker@2`/`@3` later (`systemctl enable --now
foundry-worker@{1,2,3}` — see `production-runbook.md`) — this load test is what makes that a
config change rather than a code change, and it's what should be reached for if queue depth
(`select count(*) from jobs where status='pending'`) is ever observed growing rather than
draining in production.

---

## Residual risk, stated once, plainly

This entire document is local-timing evidence with GitHub fully mocked and OpenAI latency
simulated at a fixed, historically-measured constant. It proves the queue/concurrency mechanics
are sound under real process-level contention. It does **not** prove anything about real OpenAI
or GitHub API behaviour under genuine simultaneous production load — that gap is closed by
post-launch monitoring (Sentry error rates, queue depth, GitHub/OpenAI rate-limit responses in
production logs), not by this harness, and should not be treated as settled by this document.
