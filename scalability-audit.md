# Scalability audit — Connections launch

What limits the site as more people use it, what each limit is set to
today, when it would start to hurt, and what to change when it does.
Written 2026-09-24, before the Connections push to production.

Companion files:

- `after-supabase-pro.md`: the checklist of steps waiting on paid plans.
- `docs/audits/C4-connections-production-readiness.md`: the full test record.

Laptop numbers transfer as **rankings and pass/fail**, not as milliseconds.

---

## 1 · The verdict

- **Correctness is proven locally.** Every Connections path was tested at
  scale on the local stack:
  - 144/144 browser tests and 403 unit tests.
  - The SQL security suites.
  - 553k concurrent write operations with 0 failures.
  - The full cron → digest → outbox → drain chain, exactly-once under
    overlap and crashes.
- **Capacity is estimated, not proven.** The last unknown is how real
  Supabase hardware behaves under sustained load. See §3 and the
  staging test in §7.

What local testing **cannot** prove, and is checked live after the
deploy (§7):

1. Real email delivery. Locally the mail went to a fake Resend.
2. Production's cron → Vercel call carrying the real secret. The email
   drain has used this exact path in prod for months, so the risk is the
   new URL row, not the mechanism.
3. Sustained throughput on Supabase's burstable CPU.

---

## 2 · The settings that scale, and when to change them

All of these are data rows or dashboard settings. **None needs a code change
or redeploy.**

| Setting | Now (deploy day) | After Resend Pro | After Supabase Pro | Change again when… |
|---|---|---|---|---|
| `connections_digest_url` (app_config) | **Seed once, right after `db push`** | — | — | The domain changes: re-run the full snippet |
| `digest_daily_cap` (connection_limits) | 40 (fits Resend Free's 100/day) | **800** | — | Digests hit 800 on real mornings (§4) |
| Supabase Auth → *emails sent per hour* | ⚠ **Check it today** (§5) | Raise to what Resend Pro carries | — | Launch day sign-in codes queue up |
| Supabase Auth per-IP limits | default | — | Raise for campus NAT | Campus sign-ins get refused |
| Compute size | Free | — | **Medium** | §3 triggers |
| Connection caps (10/day, 25/week, 30 outstanding) | defaults | — | — | Product decision, not scale |

---

## 3 · Database compute: the real ceiling

**Measured locally**, with realistic pacing (each member loads a page
every 15s):

| Emulated size | 50 members | 100 | 250 | 500 |
|---|---|---|---|---|
| ½ core, 1 GB (≈ Free) | p95 0.61s ✓ | p95 17–23s ✗ | ✗ | ✗ |
| 2 full cores, 2 GB | — | — | **p95 < 0.43s, 0 errors** ✓ | 0 errors, p95 9–16s ✗ |

Since then, page reads were cut 44% (018, 019 and the directory cache), so
these numbers are conservative.

**The honest caveat about Medium:**

- Supabase's Micro, Small and Medium all have **2 cores of shared,
  burstable CPU**. Medium adds RAM (4 GB) and connections. It does not
  add CPU.
- My "2 cores" row gave the database two *full* cores. Burstable
  instances only sustain a fraction of that, and burst above it for
  short spells.
- So **short spikes** (a lecture ending, an announcement email) should
  do at least as well as the table.
- **Hours of sustained heavy load** could do worse than 250 members.
- Medium is still the right choice: the extra RAM keeps the whole working
  set in memory, and it costs little to step down.
- The first plan with dedicated CPU is **Large**.

**Triggers to act on** (Dashboard → Reports → Database):

- CPU above ~70% for more than 10 minutes at a time.
- p95 page time above ~1s in Vercel analytics.
- 5xx errors from PostgREST.

The response, in order:

1. Step up one compute size. It's one click and reversible, with a
   restart of a minute or two.
2. Then look at the `pg_stat_statements` top 10 for the next query
   worth fixing.

**Where database time goes today:**

- 88% is the app's own page reads.
- Auth is 1.5%.
- Connections RPCs are under 50 ms even for the busiest member in a
  248k-connection graph.

---

## 4 · The daily digest

The digest route **only queues** mail; the drain sends it.

| Stage | Limit | Where it's set |
|---|---|---|
| Runs | Every 15 min, 08:00–11:45 UTC = 16 runs | cron `connections-digest-daily` (016) |
| Recipients per run | 50 | `RECIPIENTS_PER_RUN` in `connections-digest/route.ts` |
| **Hard ceiling** | 16 × 50 = **800 people a day** | code |
| Budget | `digest_daily_cap`, rolling 24h, enforced under a lock | app_config |
| Sending | Drain: 20 emails every 5 min = **240/hour** | `BATCH_SIZE` in `drain-email/route.ts` |

**What the numbers mean:**

- **At cap 40 (Free):** 40 people mailed in the first run, all sent
  within 10 minutes. Anyone past the 40th waits until tomorrow's budget,
  and their requests are still visible in the app.
- **At cap 800 (Resend Pro):**
  - The digest queues at most 200 an hour (4 runs × 50).
  - The drain sends 240 an hour, so it keeps up, with **~40 an hour of
    headroom** for everything else during the morning: accept notices
    and admin mail.
  - If a busy morning queues more, the backlog clears by early
    afternoon. Nothing is lost; it's only later.
- **One person gets one digest a day**, covering all their waiting
  requests. It's sized by *people with waiting requests*, not by
  requests.

**When 800 stops being enough:** when a real morning's digest budget
query (`supabase/checks/launch_capacity.sql`) shows 800 used. That means
roughly 800+ distinct members with an unanswered request every single
day, several thousand active members. The fix is a small code change,
not a setting:

- Raise `RECIPIENTS_PER_RUN`.
- Raise the drain's `BATCH_SIZE` (50 × 0.6s = 30s fits the 60s limit).

---

## 5 · Email provider budget

| Limit | Resend Free (now) | Resend Pro (tomorrow) |
|---|---|---|
| Per day | **100 total**, sign-in codes included | none |
| Per month | 3,000 | 50,000 |
| API rate | ~2 requests/s | ~2 requests/s (raisable on request) |

- **The drain is paced at 1.5 sends/s,** and a batch lasts ~12s of every
  5 minutes. Sign-in codes (sent by Supabase Auth over SMTP through the
  same Resend account) collide with it only during those 12s. Resend
  answers a collision with a 429, and the drain backs off without
  losing the email.
- **Monthly worst case on Pro:**
  - 800 digests × 30 days = 24,000.
  - Plus sign-in codes, accept notices and admin mail.
  - That fits 50,000 comfortably. Realistically digests will be a small
    fraction of 800.
- ⚠ **Supabase Auth's own email limit.**
  - With custom SMTP, Supabase starts the project's *emails sent per
    hour* at a low default (around 30).
  - That is **every sign-in code for the whole site, per hour.** On
    launch day the whole campus requests codes at once.
  - The setting is on the Free plan too (Authentication → Rate Limits).
  - Check its current value today. Raise it the moment Resend Pro is
    active, and **before any announcement**. This is the most likely
    launch-day failure, and it has nothing to do with our code.

---

## 6 · Everything else

| Component | Limit | Behaviour at scale | Status |
|---|---|---|---|
| Write concurrency | Row locks + advisory locks | 64 clients: 553k operations, 0 deadlocks, invariants intact | ✅ proven |
| Double sends / races | Idempotent RPCs | 20 parallel resends → 1 request | ✅ proven |
| Cron overlap | Digest lease + atomic complete; drain row claims | 20 overlapping digest runs and 10 overlapping drains: 0 duplicates | ✅ proven |
| Nightly purge | Loops 500-row batches, up to 50k a night | 27k-row backlog in 0.6s | ✅ proven |
| Outbox growth | Sent mail purged nightly (013) | Table stays small | ✅ |
| Database size | Free 500 MB / Pro 8 GB included | 5k-member corpus with 248k connections is well inside Pro | ✅ on Pro |
| DB connections | PostgREST and Supavisor pool them | Medium: 120 direct / 600 pooled; app uses pooled | ✅ |
| Directory cache (Upstash) | TTL 60–300s, invalidated on every write | Unfiltered first page and newest strip served from Redis. If Redis is down, pages read the DB directly (circuit breaker) | ✅ |
| App rate limits (Upstash) | Per-user buckets. Anonymous mutations: 1,200/min per IP | Campus NAT shares one IP. 1,200/min is sized for that and is a flood guard only. Page reads are never limited | ✅ |
| Connection request limits | 15/day Redis guard; 10/day, 25/week, 30 outstanding in the DB | Per member, so they scale linearly | ✅ |
| Vercel functions | Cron routes 60s max | Digest run ~1–2s; drain run ~12s | ✅ |
| pg_net responses | Auto-cleaned by pg_net | — | ✅ |

---

## 7 · Live checks after deploy

In order. Each needs a real account or real mail, so none can be proven
locally.

- [ ] `supabase/tests/verify_prod_schema.sql` passes: every function,
      grant and cron is present.
- [ ] `connections_digest_url` reads `present` and points at the `www` host.
- [ ] Two real accounts:
  - A requests B → B sees it → B accepts.
  - Both see each other's email on /connections.
  - A's "you're connected" email **arrives**.
- [ ] Withdraw and decline: the directional 3-week lock behaves as in
      the app.
- [ ] Next morning:
  - `cron.job_run_details` shows the digest runs succeeded.
  - An account left with an unanswered request received **one**
    digest.
  - An account with no waiting request received nothing.
- [ ] Kill switch: turning Connections off hides it; turning it back on
      restores it.
- [ ] **On Supabase Pro:** the staging load test (S4) on real hardware.
      This replaces §3's estimate with a measurement:
  - 100 → 250 → 500 signed-in members.
  - Pass means no errors and p95 under 5s.
  - **Never run it against the live site.**
