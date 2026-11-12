# D8 — Cost

Audit date: 2026-10-05. **These are estimates, not bills.** I have no billing access. Sizes come
from the repo (`infra/azure/provision*.sh`, the programme's E1a); usage comes from the D1 and E1b
measurements; unit prices are list prices as I know them. **Every price marked "confirm" must be
checked on the provider's pricing page before you approve.**

**Gate (programme Part D):** an owner-approved budget table, with alerts at 80%.

## Usage model (launch, 500 active members)

| Input | Value | Source |
| --- | --- | --- |
| Hard page loads per member per day | 10 | assumption; check against PostHog after launch |
| Soft navigations per member per day | 20 | assumption |
| Requests per hard load | 1 render + ~21 RSC prefetches (~6 ms each, no DB) | D1 §3, measured |
| Function invocations per day | 500 × (10 × 22 + 20) ≈ **120k** (≈ 3.6M/month) | derived |
| DB CPU per page request | ~6 ms | E1b calibration |
| Upstash commands per request | ~3 (rate limit + cache) | estimate from the code |

## Monthly run-rate

| Line | Size | Est. / month | Basis |
| --- | --- | --- | --- |
| Supabase Pro | Pro plan + **Medium** compute | **≈ $75** | $25 plan + ≈ $60 Medium − $10 credit (programme E1a; confirm) |
| Vercel Pro | 1 seat + usage | **$20 +** usage | ~3.6M invocations a month; ~20 of every 22 are cheap prefetches (D1). Price usage against Vercel's Pro usage table (confirm) |
| Azure: gateway VM | `Standard_D2s_v3`, UK South | **≈ $75–80** | pay-as-you-go Linux (confirm). B-series isn't available on this subscription (`provision.sh`) |
| Azure: worker VM | `Standard_D2s_v3`, UK South | **≈ $75–80** | same |
| Azure: disks, public IPs, storage | 2 × Standard SSD, 2 × static IP, blob (CVs, photos) | **≈ $15** | confirm |
| Azure Container Apps (AI executor) | 1 warm replica (AI plan F5) | **≈ $30–40**, from A0 | always-on small replica (confirm) |
| Resend Pro | needed for launch volume (E1d) | **$20** | confirm |
| Upstash (pay-as-you-go, 2 DBs) | ~3 commands × ~120k requests/day | **≈ $20** | $0.20 per 100k commands (confirm) |
| OpenAI: CV/GitHub ingestion | one extraction per upload/scan, capped at 30 jobs/member/day | **≈ $5–15** | small model; the cap bounds the worst case |
| OpenAI: AI modes (A1–A3) | daily caps $5 / $10 / $15 (AI plan F5) | **≤ $150–450** ceiling | the caps are the budget; actual follows usage |
| Sentry | errors + crons + uptime | **$0–26** | does the Developer plan cover 2 cron monitors + 1 uptime monitor? If not, Team (confirm) |
| PostHog | cookieless analytics | **$0** | free tier, 1M events |
| Cloudflare, domain | Free plan; domain renewal | **≈ $1** | — |
| **Total before AI** | | **≈ $330–370** | |
| **Total with AI at its caps** | | **≈ $520–850** | caps, not expected spend |

**One-off: the E3 pre-launch window.** A load-generator VM for a few hours (≈ $1–5), plus Vercel,
Supabase and Upstash usage from the k6 programme (30-minute holds, a 2-hour soak, stress). Estimate
it from the first 50-VU baseline run before the long runs, and approve it then (E1d).

## Where the money goes, and options (owner's call)

1. **The two D2s_v3 VMs (≈ $150–160, nearly half the base) are the biggest fixed line** for a
   lightly loaded gateway and worker. Options:
   - ask Azure for B-series quota (a B2s is roughly half the price; confirm);
   - put the gateway and worker on one VM (they were split on purpose; it's a resilience
     trade-off);
   - a 1-year reservation once sizes are stable.
2. **Supabase compute:** Medium is the launch tier (E1a). The step-down rule is in E1a step 5.
3. **AI:** the daily caps are the spend controls. Start at the lowest cap and raise it from
   measured cost per turn.

## Alerts at 80% (owner, in each dashboard)

| Provider | Control |
| --- | --- |
| Azure | Cost Management budget on the subscription; email at 80% and 100% |
| Supabase | Spend cap ON (E1a); usage email |
| Vercel | Spend Management: budget plus notification; pause at 100% is optional |
| OpenAI | Project budget plus alert threshold on both projects (ingestion; matching from A0) |
| Upstash | Budget/usage alert per database (pay-as-you-go) |
| Resend | Usage warnings by email (plan limits) |
| Sentry | Spike protection ON (G5) so a test or an incident can't exhaust the quota |

## Addendum: AI per-turn reserved cost, by stage (S6, 2026-10-19)

Measured locally against the fake provider's placeholder prices (`fake-mini`, `fake-embedding` —
**not real OpenAI prices**; this bounds the shape of the spend, not the dollar amount), from 20
network-mode turns run through the real executor (`ai_submit_turn` → `run_turn` → `ai_private.trace_spans`).

| Stage | Model | Calls/turn | Mean input tokens | Mean output tokens | Mean cost (micro-$) |
| --- | --- | --- | --- | --- | --- |
| `interpret` | fake-mini | 1 | 44 | 52 | 252 |
| `memory_embedding` | fake-embedding | 1 | 3 | 0 | 1 |
| **Total** | | | | | **≈ 253 micro-$/turn** |

This is network mode with pure-concept criteria, where `needs_model` (`app/ai/pipeline.py`) never
calls the assessor — `interpret` and `memory_embedding` are the only stages that ran. Recruiter mode
and any free-text criterion add an `assess`/`assess_jobs` call per batch (≤4 parallel, capped by
`ASSESS_LIMIT`=20 candidates); that stage's reserved cost was already profiled separately in the S4
outage-drill and S6 burst work as "at most 3 provider calls per turn" (memory embedding + interpret +
one retry), not re-measured here stage-by-stage.

At real OpenAI prices this scales linearly with the real model's per-token rate — the owner's capped
live smoke (owner item 23) is what turns this placeholder shape into an actual dollar figure per turn,
and from there, how many turns/day each of the five money caps (§9, `ai_private.spend_reserve`)
actually supports.

## Gate

The owner confirms the marked prices, picks the VM option, sets the AI cap, approves the table,
and sets the alerts above. Record the approved monthly figure in `after-supabase-pro.md`.
