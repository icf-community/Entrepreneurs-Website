# D2 — Security

Audit date: 2026-10-05. Branch `feat/connections`. Inline audit, with no review subagents (they
fabricated findings here before). Everything ran locally. The parts that need production (live
grant dump, ZAP active scan) are prepared here and listed for the owner and the E3 window.

**Gate (programme Part D):**
- zero open High/Critical;
- every server action checks auth and has a rate-limit decision in the registry;
- the grant dump matches the allowlist;
- every admin RPC writes to `admin_actions`, enforced by a test.

**Result: pass locally.** Two parts can only be checked against production. **(a)** The owner runs
`supabase/checks/grant_dump.sql` in prod after `db push` and diffs it against the local output.
**(b)** The ZAP active scan runs in the E3 window.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| D2-F1 | **Critical** | `next` 16.3.3: remote code execution in `next/og` ImageResponse (advisory range ≥16.2.0 <16.3.6). We don't call `next/og`, but it's the framework, so we upgrade rather than reason about reachability. | Fixed: `next` and `eslint-config-next` → 16.3.8 (published 2026-09-30). Full E2E 159 + 3 rate-limit green on 16.3.8. |
| D2-F2 | **Medium** | **Admin pages were gated only by `admin/layout.tsx`.** A soft navigation renders only the page segment, so the layout's check doesn't run (Next's own authentication guide, "Layouts"). Reproduced: a student's session replaying an admin's `/admin` → `/admin/reports` RSC request got **200 with the admin page rendered**. **No data leaked:** the admin RPC refused in-body, so `reports: []`. But it exposed the admin UI and broke "non-admins can't tell /admin exists". | Fixed: `requireAdminPage()` in `lib/auth/guard.ts` (React `cache()`, so layout and page share one check) is called by the layout **and every admin page**. Tests: `e2e/member.spec.ts` replays the captured request as a student and expects the not-found digest (fails on the old build, passes now); `src/lib/auth/adminPages.test.ts` fails for any `/admin` page without the call. |
| D2-F3 | High (most N/A) | PyJWT 2.13.0: 13 advisories, mostly JWKS-client and mixed-algorithm paths. Our only use is `app/auth.py`: HS256 pinned, static secret, `require: [exp, sub]`. urllib3 2.7.0: 3 advisories (streaming, proxy TLS). | Fixed: PyJWT 2.15.1, urllib3 2.8.0. pytest 217 passed. `pip-audit` on runtime and dev requirements: none. |
| D2-F4 | Low | Build-tool-only transitive advisories: fast-uri and brace-expansion 5.x (via the Sentry webpack plugin), brace-expansion 1.x (via eslint). DOMPurify ≤3.4.15 via posthog-js (client-side; we don't use IN_PLACE). | Fixed by caret-bounded overrides in `pnpm-workspace.yaml`. `pnpm audit --prod`: **no known vulnerabilities.** |
| D2-F5 | Low | PostHog sent a `$pageview` at init, before a synthetic account was opted out (G8 gap). | Fixed in D1 (lazy provider reads the session first). |

## Evidence, by area

### Authorization matrix

| Surface | How every entry is held to its role | Test that fails if one slips |
| --- | --- | --- |
| Pages (`page.tsx`) | Member pages call `requireApprovedUser` / `requireSignedInUser` (or `getUser` + redirect on `/settings` and `/reset-password`). Admin pages call `requireAdminPage`. Public: `/`, `/login`, `/privacy`, `/terms`, `/cookies`. | `adminPages.test.ts`; `guard.test.ts`; E2E per role (`public`, `member`, `admin` projects) |
| Server actions (~80) | Classified in `lib/actions/registry.ts` (read / write-cheap / write-costly / admin / public). | `registry.test.ts`: every action classified; admin → `requireAdmin`; costly → its own bucket. **New:** every member action reaches `getActionAuth`/`currentUser`, directly or through a same-file guard (fixpoint). Shown to fail by stripping the call from `deleteMyPost`. |
| Route handlers | Crons: `CRON_SECRET` bearer with `timingSafeEqual` (all 5). `/auth/github-connect/start`: `getActionAuth` + bucket. `/auth/callback` and `/auth/confirm`: code exchange, redirect allowlisted. `/api/health`: `{ok}` only. `/api/banner`: public by design. `/api/img`: profile pictures only, uuid4 key shape. | `health.spec.ts`, `banner.spec.ts`, cron E2E, `safeNextPath.test.ts` |
| RPCs | Revoke from `public, anon, authenticated`, then explicit grants. | `rls_smoke.sql` §21: function allowlist, and no anon EXECUTE on member RPCs (`has_function_privilege`, CLI 2.116-safe) |
| Admin RPCs | Every volatile `admin_*` / `approve_*` / `reject_*` inserts into `admin_actions`, except 7 named reads. | **New** `rls_smoke.sql` D2 block, shown to fail when a read is dropped from the list |
| Tables | RLS on **every** public table (41). Policies open to `anon` exist only on the `skills`/`sectors` taxonomy (SELECT). Tables with zero policies (e.g. `app_config` with the cron secret) deny all API access. | `rls_smoke.sql`, `adversarial_edges.sql`, `admission_roles.sql` |

### Grant dump

`supabase/checks/grant_dump.sql` is read-only and catalog-only, so it's safe to run in prod. It
lists every function EXECUTE, table privilege and column privilege held by `anon`/`authenticated`
in `public`. Local result after `db reset`: 132 functions executable by `authenticated`. 3 by
`anon`: `is_admin`, `is_approved` and `get_site_banner`, all deliberate.

**Owner (E2):** after `supabase db push`, run it in the SQL editor, export as CSV and diff against
the local output. Any line only in prod is a finding.

### Redirects and SSRF

- `safeNextPath` resolves the target with the WHATWG URL parser and compares origins, so it
  handles backslash and tab tricks (unit-tested).
- `/auth/callback` honours `next` only for the exact `/reset-password`.
- No server-side fetch takes a user-supplied URL. Listing URLs are rendered through
  `externalHref` and never fetched.

### Secrets and env

- No `process.env.X ?? "literal"` on any secret. The fallbacks that exist are public service
  defaults: the PostHog host, the site URL, and the contact and appeals inboxes.
- `NEXT_PUBLIC_*` holds only public values: Supabase URL and anon key, the PostHog key and host,
  the Sentry DSN, the Turnstile site key and the site URL.

### Headers and CSP

- Nonce CSP on dynamic routes.
- Static routes (`/`, legal pages) use `'unsafe-inline'`. B27 confirmed they render no
  user-controlled content.

### Uploads (gateway)

pytest covers:
- type from magic bytes, not the file name;
- SVG rejected;
- EXIF and GPS stripped;
- decompression bomb and zip-bomb DOCX rejected;
- polyglot neutralised;
- PDF open-action scripts and password-protected PDFs rejected;
- oversize bodies rejected before parsing;
- delete body capped at 413 (B22);
- upload ticket `aud`/`iss` (B21).

### Dependencies

| Scope | Result |
| --- | --- |
| `pnpm audit --prod` | 0 |
| `pnpm audit`, all | 1 high: `braces` ≤3.0.3, via `eslint-config-next` → fast-glob; dev-only, **no patched release exists** |
| `pip-audit`, runtime + dev | 0 |
| Trivy, gateway image | 0 fixable HIGH/CRITICAL. 55 unfixed upstream in the Debian bookworm base (CI already gates with `--ignore-unfixed`) |

## Accepted risks (recorded per B28 and B11)

| Risk | Why accepted |
| --- | --- |
| `clearRecoveryMarker` has no auth | It only clears the caller's own cookie. |
| The `mutations` backstop fails open | Deliberate, so an Upstash outage doesn't lock members out of their own data. Costly writes have their own fail-closed buckets, and the prod boot alarm fires if Upstash is missing. |
| `/api/img` is unauthenticated | Needed for `/committee` avatars shown to signed-out visitors. Limited to `profile_picture`, and keys are unguessable uuid4 (B2). |
| OTP pre-check is advisory (B11) | A client can call Supabase `verifyOtp` directly. Supabase Auth's own per-IP limits are the real control. **Owner (O3/E1d):** 500 per 5 min, with CAPTCHA on. |
| Default table privileges | `anon`/`authenticated` hold Supabase's default privileges on 26 tables, including TRUNCATE, REFERENCES and TRIGGER. PostgREST can't issue those, the API roles can't log in, and every table has RLS. Not revoked, to avoid touching default privileges (the CLI 2.106 grants incident). **Revisit post-launch.** |
| `braces` (dev-only, no fix) | Never reaches the deployed app. |
| Debian base packages with no upstream fix | CI fails on anything fixable. A `python:3.12-slim-trixie` base is a later option. |
| Admin RPCs that read without logging | Pure reads, so they're intentionally absent from `admin_actions`. `admin_get_signup_emails` reads emails for the admin list. CV access has its own log (`admin_log_cv_access`). |

## Open, owner or prod window

- **E2:** the grant dump diff in production.
- **E3:** ZAP **active** scan against the pre-launch prod window with synthetic users. The
  baseline workflow exists (`zap-baseline.yml`, manual). Optionally an external pentest before
  public launch.
- **E1d/O3:** Supabase Auth per-IP limits, and CAPTCHA toggle on.
- **D7 (next audit):** `aquasecurity/trivy-action` is pinned by tag, not SHA.
