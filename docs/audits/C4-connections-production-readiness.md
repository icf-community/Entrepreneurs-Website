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

Thirteen migrations, `20260917000001` through `20260917000013`:

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

Plus, outside the migrations: the `/connections` UI, the admin surface,
`ratelimit.ts` buckets, `frontend/src/app/api/cron/connections-digest`,
the compliance edits in `docs/compliance/`, and the privacy and terms
pages.

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

### 2 · The push

- [ ] `supabase db push`. Thirteen migrations, all additive — no column is
      dropped and no existing function signature changes, so there is no
      window where the deployed frontend is talking to a schema it does not
      understand.
- [ ] Run `supabase/snippets/seed_app_config.sql`. **This is the step that
      fails silently if skipped.** `connections_digest_url` is a new key;
      without it `cron_connection_digest` raises a warning, SUCCEEDS, and
      mails nobody, forever. The member-facing symptom is "nobody ever
      answers my connection requests", which no one reports as a bug.

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
      `connections-digest-daily` (08:00).
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
- [ ] Confirm the digest arrives the following morning for an account with
      an unanswered request, and does **not** arrive for one with none.
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
