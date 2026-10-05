# D7 — Supply chain and CI

Audit date: 2026-10-05. Branch `feat/connections`. Workflows, lockfiles, and the GitHub repository
state (read-only API).

**Gate (programme Part D):** no unpinned third-party action; required checks documented.

**Result:**
- **Pinning: pass.** Every third-party action is pinned to a commit SHA and the CI service images
  to a digest.
- **Required checks:** documented below. `main` currently has **no branch protection**, so
  setting it is an owner step.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| D7-F1 | Medium | Six third-party actions were pinned by tag, which can be moved after the fact. That covers the deploy path (`azure/login`, which holds the OIDC federation to production) and the security scanners themselves (`trivy-action`, `zaproxy/action-baseline`). | Pinned to commit SHAs with the version as a comment: `supabase/setup-cli` v2.1.2, `pnpm/action-setup` v5.0.0, `azure/login` v3.1.0, `dorny/paths-filter` v4.0.3, `aquasecurity/trivy-action` v0.36.0, `zaproxy/action-baseline` v0.15.0. The trivy and ZAP commits were checked first: each is an ancestor of the default branch, dated minutes before its release. `redis:7-alpine` (CI service) pinned by digest; SRH and TruffleHog already were (B14). `actionlint`: no errors. |
| D7-F2 | Medium | **`main` has no branch protection** (`GET …/branches/main/protection` → 404). A direct push skips CI, and nothing requires the checks below before a merge. | **Owner:** Settings → Branches → protect `main`: require a PR, require the checks below, include administrators. |
| D7-F3 | Info | 42 open Dependabot alerts on `main`: PyJWT, urllib3, next, fast-uri, brace-expansion and DOMPurify. | All fixed on this branch (D2), so they close when it merges. CodeQL: 0 open. |

## Required status checks (for D7-F2)

From `ci.yml`, `codeql.yml` and `secret-scan.yml`, which all run on pull requests:

- `Lint · Typecheck · Build · Test`
- `Upload gateway (pytest)`
- `Upload gateway (docker build + scan)`
- `RLS smoke (Supabase)`
- `E2E (Playwright)`
- `E2E rate-limit enforcement (SRH)`
- `Analyze (javascript-typescript)` and `Analyze (python)` (CodeQL)
- `TruffleHog`

The path-filtered jobs report *skipped* on PRs that don't touch their paths, and GitHub treats a
skipped required check as passing. PRs into `main` run the full set regardless (B14).

## Already in place

| Control | Where |
| --- | --- |
| Frozen lockfile in CI | `pnpm install --frozen-lockfile` (`ci.yml`) |
| Exact Python pins (the full closure) | `server/requirements.txt`, `requirements-dev.txt` (`-r requirements.txt`) |
| Caret-bounded overrides for transitive fixes | `frontend/pnpm-workspace.yaml` (updated in D2) |
| Build scripts allow-listed | `pnpm-workspace.yaml` `allowBuilds` |
| Supabase CLI pinned in CI | 2.105.0 (2.106 broke local grants) |
| Image scan on every gateway build | Trivy, HIGH/CRITICAL, fixable only |
| Secret scan on PRs and on a schedule | TruffleHog, SHA-pinned |
| Static analysis | CodeQL, JS/TS and Python |

## Watch

- **E2E runtime (F24):** D4 added 92 axe scans, taking the local run to 6.6 min (254 tests). The
  last `main` CI run took 9 min against 3.3 min locally, about 2.7×, which projects to roughly
  18 of the job's 30-minute cap (about 60%). The trigger for moving specs into their own job is
  75%. If the release PR's CI run is over 22 minutes, move `axe.spec.ts` into its own job.
- **SHA pins go stale:** Dependabot security updates still open PRs for vulnerable action
  versions. Routine version bumps stay manual (the owner chose not to use Renovate).
