# C4 — Connections, production readiness

**Status: DEFERRED, deliberately. Nothing in this document has been run
against production.**

Audit 17 of the Connections plan says: push the migration, then verify
against prod directly rather than trusting a green pipeline, confirm the
cron job is registered and firing, flip the kill switch, and do a real
two-account handshake on the live site.

None of that has happened, and it should not happen yet. The standing
instruction on this branch is **no prod pushes until the branch is
finished, then one batched PR-to-main push**. Running audit 17 early would
mean pushing thirteen migrations to a live database mid-branch, which is
the opposite of what that instruction is protecting.

So this is the checklist audit 17 becomes when it is unblocked, written
now while the detail is fresh rather than reconstructed later from the
migration files. **An audit whose only output is "we'll check at deploy
time" cannot be re-run or disputed**, which is the same reason every other
audit in this series has a file.

---

## What ships

Seventeen migrations, `20260917000001` through `20260917000017`:

| # | File | What it is |
|---|---|---|
| 001 | `connections` | Tables, indexes, RLS (deny-all, no policies), kill switch, limits config |
| 002 | `connections_rpcs_write` | send / respond / withdraw / remove / block / unblock / report |
| 003 | `connections_rpcs_read` | list / state / badge / graph / facets |
| 004 | `connections_admin_cron` | Admin surface, the three retention & digest crons |
| 005 | `connections_keyset_pushdown` | C3 Finding 1 — the keyset page was not bounding its work |
| 006 | `fix_admin_delete_graduates` | C3 Finding 2 — `column reference user_id is ambiguous` on a non-empty cohort |
| 007 | `list_my_blocked_members` | The unblock surface |
| 008 | `report_connection_returns_filed` | Idempotent re-report |
| 009 | `admin_delete_graduates_never_deletes_caller` | An admin in the cohort deleted themselves |
| 010 | `connection_graph_filters` | Filters apply to both views, not just the cards |
| 011 | `purge_settled_connections` | Declined / withdrawn / expired rows were kept forever |
| 012 | `block_cannot_launder_cooldown` | Block → unblock reset a running cooldown; block had no cap |
| 013 | `purge_sent_outbound_email` | The outbound queue was an archive of every message body |
| 014 | `index_settled_connection_purge` | The nightly purge from 011 was a full seq scan at scale (measured 28.9ms at 5k/248k, but reads/sorts every row) — added a partial index so it seeks instead |
| 015 | `report_connection_validates_input` | An invalid `category`/`reason` used to fall through to Postgres's raw 23514, which puts the whole failing row — including `note_snapshot`, the private note — in PostgREST's error `details`. Now validated before the insert, same message either way |
| 016 | `digest_lease_and_budget` | S1 digest redesign — claims whole recipients under a 10-minute lease, then stamps and queues in one transaction (no lost or doubled digests on a crash); enforces the 20h spacing that was registered but never read; adds `digest_daily_cap` (default 40); reschedules the digest to every 15 min, 08:00–11:45 UTC |
| 017 | `connections_directional_cooldown` | C7 LinkedIn parity — the 3-week cooldown holds only the member who SENT the settled request (withdrawer / declined sender); remove holds nobody and removed rows purge nightly; block-then-unblock can't launder a sender's hold; `connection_state_with` gains `withdrawn_by_me` + `available_at`; new `my_connection_quota()` so Connect greys out at a limit |

Plus, outside the migrations: the `/connections` UI, the admin surface,
`ratelimit.ts` buckets, `frontend/src/app/api/cron/connections-digest`,
the compliance edits in `docs/compliance/`, and the privacy and terms
pages. As of 2026-09-22 that also includes a follow-up frontend-only
commit closing four previously-flagged findings (login return-path,
kill-switch button state, stale-card cleanup, a `cache.ts` env fallback
bug) — no new migrations, so nothing above changes because of it.

---

## The checklist, in order

### 1 · Before the push

- [ ] `supabase db reset` locally, then all four SQL suites green:
      `rls_smoke.sql`, `adversarial_edges.sql`, `admission_roles.sql`,
      `verify_prod_schema.sql`.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`
      in ONE script — never a build from earlier (see
      [[always-rebuild-before-e2e]]).
- [ ] Take a `db dump --db-url` backup on the **session pooler** (Direct is
      IPv6-only, and the free tier has no dashboard backups).
- [ ] Confirm the Resend plan. The `outbound_email` header records a free
      tier of 100/day; a launch burst of digests plus auth mail can exceed
      that. The queue's backoff degrades it to "delivered later", which is
      acceptable for a digest and **not** acceptable for a sign-in OTP.
      `digest_daily_cap` (default 40) keeps digests inside the free tier;
      once Resend Pro is live, raise it:
      `update app_config set value = (value::jsonb || '{"digest_daily_cap":800}')::text where key = 'connection_limits';`

### 2 · The push

- [ ] `supabase db push`, **before** the frontend deploy. Seventeen migrations, all additive — no column is
      dropped. 016 and 017 change the return types of `claim_connection_digests`
      and `connection_state_with`, but prod has no Connections schema yet, so
      nothing deployed calls the old shapes. Schema first matters anyway: the new digest route calls
      `complete_connection_digests`, which only exists once 016 is applied.
- [ ] Run `supabase/snippets/seed_app_config.sql`. **This is the step that
      fails silently if skipped.** `connections_digest_url` is a new key;
      without it `cron_connection_digest` raises a warning, SUCCEEDS, and
      mails nobody, forever. The member-facing symptom is "nobody ever
      answers my connection requests", which no one reports as a bug.
      **Prod is already seeded for the other crons, so add only this row.**
      It copies the origin from the live email-drain URL and never touches
      `cron_secret` (a wrong secret silently stops every cron, email
      included):
      ```sql
      insert into public.app_config (key, value)
      select 'connections_digest_url',
             replace(value, '/api/cron/drain-email', '/api/cron/connections-digest')
        from public.app_config where key = 'drain_email_url'
      on conflict (key) do nothing;
      ```
      Then run only the verification `select` at the bottom of the
      snippet; `connections_digest_url` must read `present` and show
      `https://www.…/api/cron/connections-digest`. On the domain change,
      re-run the full snippet with the new origin, which rewrites every
      URL row.

### 3 · Verify against the database itself, not the pipeline

CI green is not running code — that lesson is already recorded
([[deploy-pipeline-stale-latest-tag]]). Run these against prod:

- [ ] `supabase/tests/verify_prod_schema.sql`. §7f-ii must read **OK**, not
      the WARN it correctly shows locally. §7g must find all **four** cron
      jobs registered and active.
- [ ] `select jobname, schedule, active from cron.job` — expect
      `expire-connection-requests-daily` (02:40),
      `purge-connection-records-daily` (02:45),
      `purge-outbound-email-daily` (02:50),
      `connections-digest-daily` (`*/15 8-11 * * *` — every 15 min, 08:00–11:45 UTC).
- [ ] Come back the next day and check `cron.job_run_details` for all four.
      A registered job that has never fired looks identical to a healthy one
      until you look here.
- [ ] Spot-check the grants with `has_function_privilege` rather than
      trusting the migration text — on Supabase `revoke ... from public` is
      a no-op ([[function-grant-default-privileges]]), and the local CLI has
      its own segfault quirk around permission-denied SECURITY DEFINER calls
      ([[supabase-cli-2116-segfault]]).

### 4 · Exercise it on the live site

- [ ] A real two-account handshake: request → the recipient sees it with the
      card and note → accept → **both** addresses visible → copy → remove →
      gone for both.
- [ ] Confirm the accept email arrives, and that it names the right address.
- [ ] Connect → the "Connect with {name}?" dialog; ✕ and Cancel send nothing.
      Send → the profile shows **Pending**; Pending → Withdraw → "You can
      send {name} a new one from {date}". From the OTHER account, open the
      withdrawer's profile: Connect is live and the request arrives.
- [ ] Decline a request, then send one back from the decliner's account — it
      must go through. From the declined account, the profile must say only
      "You can't send a request to this member right now" (never "declined").
- [ ] Confirm the digest arrives the following morning (08:00–11:45 UTC
      window) for an account with an unanswered request, arrives **once**,
      and does **not** arrive for one with none. Then run the digest-budget
      query in `supabase/checks/launch_capacity.sql`.
- [ ] Flip the kill switch off in the admin surface and confirm the exact
      documented behaviour: **new requests refuse; accept, decline,
      withdraw, block, report, remove and the digest all keep working.**
      Flipping it must not strand people mid-handshake. Flip it back on.
- [ ] `node scripts/prod-smoke.mjs`.

### 5 · Before announcing

- [ ] Know who can flip the kill switch, and that they can reach the admin
      page from a phone.
- [ ] `consent_version` is non-null on every accepted row. It is the
      Art. 7(1) evidence and a null column would only be noticed at the
      moment it mattered.
- [ ] The privacy policy and terms pages deployed with the same push. Both
      now describe this feature; shipping the feature without them is the
      one ordering that is actually wrong.

---

## Local verification, 2026-09-23 (5k members / 248k connections)

Run on the local stack before the prod push. Laptop numbers: the
rankings and the pass/fail results transfer to prod; the milliseconds
don't.

- **Cron chain, end to end:** real pg_cron → pg_net → digest route →
  outbox → pg_cron → drain route → a local fake Resend that injects 429s
  and 500s.
  - **Cap 40:** exactly 40 recipients across 3 firings, then 0.
  - **Cap 800 under 20-way concurrent bursts:** exactly 800, never
    more, no recipient twice, no split digests, subjects match the
    stamped counts.
  - **Crash between claim and complete:** the lease holds the budget.
    After it lapses, all 50 recipients are mailed exactly once, and the
    stale completer queues 0.
  - **Drain under 10 overlapping runs:** 956 sent = 956 received, 0
    duplicate sends. 429s don't burn an attempt; 500s back off.
- **Retention purge:** it deleted only 500 rows a night, with removed
  rows sorted last, which broke privacy §6's "within a day". It now loops
  bounded batches (017). A worst-case 27,280-row backlog clears in one
  run in 0.6s.
- **Write concurrency** (pgbench, 64 clients, 60s, 200 members,
  random send / mutual send / accept / decline / withdraw / remove /
  block / unblock): 553k operations, ~19.6k real state changes.
  - 0 failed transactions, 0 deadlocks.
  - Invariants hold: no duplicate pairs, no accepted row without
    consent, every pending row has its `requested` event.
- **Read load** (k6, signed-in): 100 users → 0 errors, p95 < 3s on
  all three `/connections` views.
  - 250 users fails locally, and that's this laptop's ceiling, not the
    app's. Docker Desktop's port proxy drops sockets above ~250
    concurrent connections: a bare Node fetch storm fails the same way,
    and the local GoTrue container exhausts ephemeral ports under
    sustained load.
  - The 250/500 answer needs the staging run (`tasks/todo.md` S4).
- **Scale query plans:** every Connections RPC is under 50 ms for the
  busiest member; the graph is 13 ms. The harness also had a
  nested-transaction bug that committed its "rolled back" sections.
  That's fixed (a savepoint), and a run now leaves row counts unchanged.
- **Browser, by hand:**
  - The confirm dialog: Escape closes only it, and focus returns to
    Connect.
  - An over-length note is blocked, with a count.
  - An HTML note renders as inert text.
  - A double-click sends once.
  - The declined sender sees only the generic line.
  - A direct-API resend, block → unblock → resend, and 20 parallel
    resends are all refused.
  - The limit state is disabled with its reason exposed to screen
    readers, and nothing scrolls sideways at 400px.
- **Suites:** Vitest 402/402. Full E2E 146/146 with rate limiting off.
  With a local SRH Redis: rate-limit 3/3 and Connections 17/17. SQL
  suites are green.

---

## What is NOT on this list, and why

**A staging environment.** There isn't one, and inventing one for this
feature would be a bigger change than the feature. The mitigations are the
five-thousand-member local corpus (C3), the four SQL suites, and the kill
switch.

**A load test against prod.** The C2 harnesses now carry the three
`/connections` reads, but pointing k6 at production to find out whether it
holds is a way of causing the outage you were checking for. It runs against
local or a throwaway project, as C2 did.

**Gradual rollout.** There is no flag infrastructure for a percentage
rollout and the kill switch is the honest substitute: one boolean, instant,
and it degrades to "you cannot start something new" rather than "your
pending requests vanished".
