# 05 · Data Breach Incident Response Plan

DRAFT for the controller's review. Defines how a suspected personal-data breach is detected,
contained, assessed, reported and recovered from.
**Controller:** IC Founders Ltd (Companies House 17171277) — see `02-ropa.md` §1.

> **The controller owns the notification clock.** The statutory 72-hour clock for notifying
> the ICO runs against the **Controller**, which is IC Founders Ltd — not Imperial College
> London, which is not a joint controller of this service (see `02-ropa.md` §1). Any
> suspected breach of personal data **must be reported to the controller's data protection
> contact without delay**; that person owns the ICO and data-subject notification decisions.
> Imperial may be told as a courtesy, given the platform's affiliation with the College, but
> that notice does not substitute for or delay the controller's own 72-hour obligation.

---

## 1. Roles

| Role | Responsibility | Holder |
|------|----------------|--------|
| Incident Lead | Coordinates response, owns the timeline log | IAA — ⚠ CONFIRM |
| Escalation | Notifies the controller's data protection contact; owns ICO decision | IAO / controller's data protection contact — ⚠ CONFIRM |
| Technical responder | Executes containment & rotation | Project owner |

## 2. Detection sources

- **Sentry** error alerts (production exceptions, auth failures, anomalous errors).
- **Upstash / Cloudflare** abuse signals (rate-limit spikes, bot traffic, WAF events).
- **Supabase** logs / dashboard (unexpected queries, auth anomalies).
- **Vendor notifications** (a sub-processor reporting their own breach).
- **User / third-party report** via contact@ / appeals@.

## 3. Severity triage (within 1 hour of detection)

| Level | Example | Action |
|-------|---------|--------|
| **P1 — confirmed personal-data exposure** | Service-role key leaked; database read by an unauthorised party; bulk member data exfiltrated | Full response §4–§7; notify the controller's data protection contact **immediately** |
| **P2 — credible risk, unconfirmed** | Suspicious access pattern; a secret possibly exposed | Contain & investigate §4–§5; brief the controller's data protection contact |
| **P3 — no personal data at risk** | Rate-limit abuse; bot spam blocked by Turnstile | Log, monitor, harden; no notification required |

## 4. Containment — credential rotation runbook

Rotate the moment exposure of a secret is suspected (P1/P2). Order by blast radius:

1. **Supabase `service_role` key** (bypasses RLS — highest impact): rotate in Supabase →
   Settings → API; update the value in Vercel env; redeploy.
2. **Supabase `anon` key / JWT secret** if auth tokens may be compromised.
3. **`RESEND_API_KEY`** — revoke in the Resend dashboard, issue a new key, update Vercel env.
4. **`CRON_SECRET`** — regenerate; update Vercel env and the scheduler.
5. **Upstash REST URL/token** — rotate in the Upstash console; update Vercel env.
6. **Sentry DSN** if it may have been abused.
7. **Force-revoke user sessions** if account tokens are at risk (Supabase Auth → sign-out all).
8. If a Google/admin account is implicated, reset its password and revoke its sessions; remove
   its `admins` row if compromise is suspected.

After rotation: **redeploy** so all serverless functions pick up new secrets, and confirm the
old credentials are dead.

## 5. Assess (scope & risk)

- What data, how many subjects, what categories, and is it now accessible/usable by an
  unauthorised party?
- Confirm whether RLS / access controls actually limited exposure (often they will have).
- Preserve evidence: relevant Supabase/Vercel/Cloudflare/Sentry logs, timestamps, IPs.
- Record everything in a single timestamped incident log from first detection.

## 6. Notify

- **Controller's data protection contact: immediately** on any P1/P2 — they decide on ICO and
  data-subject notification. Imperial may be told as a courtesy given the platform's
  affiliation with the College, but this does not substitute for that decision.
- **ICO (by the Controller): within 72 hours** of becoming aware, if the breach is likely to
  risk individuals' rights and freedoms.
- **Affected data subjects: without undue delay** if the breach is likely to result in a **high**
  risk to them (decision owned by the controller's data protection contact).
- **Sub-processor / vendor** if the breach originates with or involves them.

## 7. Recover & learn

- Restore service from a known-good state; confirm the vulnerability is closed.
- Post-incident review: root cause, what worked, what to change.
- Feed fixes back into code/config and update this plan and **04 · Internal Data Handling Protocol**.

## 8. Pre-incident readiness checklist

- [ ] MFA enabled on every console (Supabase, Vercel, Cloudflare, Resend, PostHog, Sentry, Upstash, inbox).
- [ ] Sentry alerting routed to a monitored channel.
- [ ] Current list of who holds which access (for fast revocation).
- [ ] This plan + Imperial's institutional breach procedure both linked and known to the team.
- [ ] A periodic (e.g. annual) tabletop walk-through of a simulated P1.
