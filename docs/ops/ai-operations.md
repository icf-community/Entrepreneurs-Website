# AI operations

`/admin/ai` shows aggregate counts only. An approved admin can read it; an AI operator
must also be an admin to change switches or limits. Each admin's first view in a UTC
hour is recorded in `admin_actions`. Searches, member IDs and candidate evidence are
not included in the dashboard or refusal counters.

Admission refusals and status polls cover the current UTC hour plus the previous 23
hour buckets; counters expire after 14 days. Provider failures and queue-wait
percentiles use a rolling 24-hour window. Queue wait is submission to first claim;
result time is submission to completion. Poll counting does not change the turn's
revision or invalidate its ETag.

Reserved cost includes uncertain calls at their full upper bound. Settled cost uses
provider-reported usage. Projected daily cost extrapolates today's charged cost over
at least one hour; it is an estimate, not a spending authorisation. Prices must be
confirmed in `ai_private.model_prices` before using these numbers for a launch
budget. The ingestion and matching ledgers share the controller cap.

Investigate sustained denial at 100 capacity/rate/budget refusals over the current
and preceding hour. Investigate query-embedding churn when more than 100 rows are
created per hour and the ratio exceeds 10 rows per admitted turn. Health reports
fire at first failure, then hourly until recovery. These are operational thresholds;
review them against measured traffic before enabling alerts.

## Investigating a slow or failed turn

Use the Supabase SQL editor with an authorised database operator account:

```sql
select * from ai_private.ai_turn_timeline('<turn UUID>');
select * from ai_private.ai_slowest_stages order by p95_ms desc;
select * from ai_private.ai_latest_errors;
```

The objects expose stage/model/outcome/token/cost/timing metadata. They are deliberately
unavailable to the frontend, service role, executor and CV-worker logins. Do not add
criteria, prompts, CV text or raw provider errors to these views.

## Raising capacity

1. Record the current settings, flags, UTC time and reason. Require a persistently
   full queue and healthy DB, executor and provider headroom. Budget exhaustion or
   provider 429s are reasons to investigate, not to raise concurrency.
2. Keep all money caps unchanged. Increase `active_turn_ceiling` by no more than 25%
   (floor to an integer), within its hard maximum of 50. The RPC enforces this.
3. Canary one mode for 15 minutes. Watch admission p95, queue wait, 429/5xx/timeouts,
   provider requests versus the ceiling, database CPU, and reserved/settled cost.
4. Roll back to the recorded ceiling if p95 or error rate worsens, the provider cap
   stays saturated, or database sustained CPU reaches 70%. Keep a reason on the
   rollback. Do not simultaneously change concurrency, prices and money caps.
5. For an incident, turn the affected mode off (master switch for a broad outage).
   Let existing reservations settle or become unknown; never release an uncertain
   call merely to recover budget. Recovery uses normal admission and claim limits.

Hosted measurements and the capped live model smoke remain release gates in the
owner verification runbook. Local fake-provider performance cannot establish them.
