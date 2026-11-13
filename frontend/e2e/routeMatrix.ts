import { readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";

// ════════════════════════════════════════════════════════════════════
// Foundry · the route × role matrix (AI-plan §14.4, gap 23).
//
// Every page.tsx under src/app gates access one of a handful of ways
// (requireApprovedUser, requireAdminPage, or a handful of pages with
// their own hand-rolled check). Rather than hand-writing one outcome per
// page per role — 55 pages × 7 roles, almost all identical — each page
// is tagged with the *gate* it actually calls, and the outcome per role
// is derived once per gate. A page whose behaviour doesn't fit an
// existing gate gets a new one here, which is the point: adding a page
// without adding a row below is what `routeMatrix.test.ts` catches.
// ════════════════════════════════════════════════════════════════════

export type MatrixRole =
  | "loggedOut" | "pending" | "rejected" | "student" | "alum" | "admin" | "operator";

export const ROLE_TO_FIXTURE: Record<MatrixRole, import("./fixtures").Role | null> = {
  loggedOut: null,
  pending: "matrixPending",
  rejected: "matrixRejected",
  student: "student",
  alum: "matrixAlum",
  admin: "admin",
  operator: "matrixOperator",
};

export type Outcome =
  | { kind: "render" }
  | { kind: "redirect"; to: string }
  | { kind: "notFound" };

type Gate =
  | "public"            // no gate; identical for every role
  | "noMarkerRedirect"  // /reset-password with no recovery token: always → /login
  | "signedInOnly"      // any signed-in user renders regardless of status; loggedOut → /login
  | "approved"          // requireApprovedUser(): approved/admin render, else redirected by status
  | "adminPage"         // requireAdminPage(): non-admin gets notFound(), not a redirect
  | "intake"            // /intake's own hand-rolled status routing
  | "onboarding"        // /onboarding's own hand-rolled status routing
  | "pendingHome"       // /pending is itself the pending_review status's home
  | "rejectedHome"      // /rejected is itself the rejected status's home
  | "featureFlaggedOff"; // behind a flag that's currently off (e.g. MESSAGING_ENABLED): redirects everyone to /home, even past requireApprovedUser

// Dynamic segments get a bogus id. Every "approved"-gated [id] page runs
// its gate before the DB lookup (confirmed by reading each one), so a
// non-existent id still exercises the gate; for a role that gets past the
// gate it lands on the page's own "this no longer exists" state, which is
// still a `render` (200, not a Next notFound()).
const BOGUS_ID = "00000000-0000-0000-0000-000000000000";

export const ROUTES: { path: string; gate: Gate }[] = [
  // Public / unauthenticated-safe — same outcome for every role.
  { path: "/", gate: "public" },
  { path: "/login", gate: "public" },
  { path: "/ai-notice", gate: "public" },
  { path: "/contact", gate: "public" },
  { path: "/cookies", gate: "public" },
  { path: "/privacy", gate: "public" },
  { path: "/terms", gate: "public" },
  { path: "/reset-password", gate: "noMarkerRedirect" },
  { path: "/settings", gate: "signedInOnly" },

  // Member pages behind requireApprovedUser (incl. /home's bounceToIntake
  // and /profile's inline equivalent — both collapse to the same outcome
  // as plain "approved" for every seeded fixture here).
  { path: "/home", gate: "approved" },
  { path: "/profile", gate: "approved" },
  { path: "/calendar", gate: "approved" },
  { path: "/committee", gate: "approved" },
  { path: "/community", gate: "approved" },
  { path: "/community/mine", gate: "approved" },
  { path: "/connections", gate: "approved" },
  { path: "/events", gate: "approved" },
  { path: `/events/${BOGUS_ID}`, gate: "approved" },
  { path: `/events/${BOGUS_ID}/edit`, gate: "approved" },
  { path: "/events/new", gate: "approved" },
  { path: "/foundry-ai", gate: "approved" },
  { path: "/members", gate: "approved" },
  { path: "/messaging", gate: "featureFlaggedOff" },
  { path: "/my-activity", gate: "approved" },
  { path: "/my-bookmarks", gate: "approved" },
  { path: "/my-submissions", gate: "approved" },
  { path: "/notifications", gate: "approved" },
  { path: "/opportunities", gate: "approved" },
  { path: `/opportunities/${BOGUS_ID}`, gate: "approved" },
  { path: `/opportunities/${BOGUS_ID}/edit`, gate: "approved" },
  { path: "/opportunities/new", gate: "approved" },
  { path: "/vcs", gate: "approved" },
  { path: `/vcs/${BOGUS_ID}`, gate: "approved" },
  { path: `/vcs/${BOGUS_ID}/edit`, gate: "approved" },
  { path: "/vcs/new", gate: "approved" },

  // Pages with their own hand-rolled status routing.
  { path: "/intake", gate: "intake" },
  { path: "/onboarding", gate: "onboarding" },
  { path: "/pending", gate: "pendingHome" },
  { path: "/rejected", gate: "rejectedHome" },

  // Admin pages: requireAdminPage() — a non-admin gets notFound(), not a redirect.
  { path: "/admin", gate: "adminPage" },
  { path: "/admin/ai", gate: "adminPage" },
  { path: "/admin/banner", gate: "adminPage" },
  { path: "/admin/community", gate: "adminPage" },
  { path: "/admin/connections", gate: "adminPage" },
  { path: "/admin/design-system", gate: "adminPage" },
  { path: "/admin/edits", gate: "adminPage" },
  { path: "/admin/events", gate: "adminPage" },
  { path: "/admin/events/new", gate: "adminPage" },
  { path: "/admin/graduates", gate: "adminPage" },
  { path: "/admin/members", gate: "adminPage" },
  { path: "/admin/opportunities", gate: "adminPage" },
  { path: "/admin/opportunities/new", gate: "adminPage" },
  { path: "/admin/reports", gate: "adminPage" },
  { path: "/admin/users", gate: "adminPage" },
  { path: "/admin/vcs", gate: "adminPage" },
  { path: "/admin/vcs/new", gate: "adminPage" },
];

export function expectedOutcome(gate: Gate, role: MatrixRole): Outcome {
  const isAdmin = role === "admin" || role === "operator";

  switch (gate) {
    case "public":
      return { kind: "render" };

    case "noMarkerRedirect":
      return { kind: "redirect", to: "/login" };

    case "signedInOnly":
      return role === "loggedOut" ? { kind: "redirect", to: "/login" } : { kind: "render" };

    case "adminPage":
      return isAdmin ? { kind: "render" } : { kind: "notFound" };

    case "approved": {
      if (isAdmin) return { kind: "render" };
      if (role === "loggedOut") return { kind: "redirect", to: "/login" };
      if (role === "pending") return { kind: "redirect", to: "/pending" };
      if (role === "rejected") return { kind: "redirect", to: "/rejected" };
      return { kind: "render" }; // student, alum
    }

    case "intake": {
      if (isAdmin) return { kind: "render" };
      if (role === "loggedOut") return { kind: "redirect", to: "/login" };
      if (role === "pending") return { kind: "redirect", to: "/pending" };
      if (role === "rejected") return { kind: "redirect", to: "/rejected" };
      return { kind: "render" }; // student/alum fixtures are both profile_version 1 (intake not done)
    }

    case "onboarding": {
      if (isAdmin) return { kind: "render" };
      if (role === "loggedOut") return { kind: "redirect", to: "/login" };
      if (role === "pending") return { kind: "redirect", to: "/pending" };
      if (role === "rejected") return { kind: "redirect", to: "/rejected" };
      return { kind: "redirect", to: "/home" }; // approved, not pending_onboarding
    }

    case "pendingHome": {
      if (isAdmin) return { kind: "render" };
      if (role === "loggedOut") return { kind: "redirect", to: "/login" };
      if (role === "pending") return { kind: "render" }; // this IS pending_review's home
      if (role === "rejected") return { kind: "redirect", to: "/rejected" };
      return { kind: "redirect", to: "/home" }; // student, alum
    }

    case "featureFlaggedOff": {
      // The flag check runs before requireApprovedUser() and has no admin
      // bypass, so every role redirects to /home first — then /home's own
      // "approved" gate decides from there (hence this mirrors "approved",
      // except the render case lands ON /home, a different path than the
      // one requested, so it's a redirect too, not a render).
      if (role === "loggedOut") return { kind: "redirect", to: "/login" };
      if (role === "pending") return { kind: "redirect", to: "/pending" };
      if (role === "rejected") return { kind: "redirect", to: "/rejected" };
      return { kind: "redirect", to: "/home" }; // student, alum, admin, operator
    }

    case "rejectedHome": {
      if (isAdmin) return { kind: "render" };
      if (role === "loggedOut") return { kind: "redirect", to: "/login" };
      if (role === "pending") return { kind: "redirect", to: "/pending" };
      if (role === "rejected") return { kind: "render" }; // this IS rejected's home
      return { kind: "redirect", to: "/home" }; // student, alum
    }
  }
}

/** Every page.tsx under src/app, as a route path (dynamic segments as `[id]`). Used by routeMatrix.test.ts to catch an unmapped page. */
export function discoverPageFiles(appDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") out.push(full);
    }
  };
  walk(appDir);
  return out
    .map((f) => relative(appDir, dirname(f)))
    .map((d) => (d === "." ? "/" : `/${d}`))
    .sort();
}

export function routePathToAppDir(routePath: string): string {
  return routePath.replaceAll(BOGUS_ID, "[id]");
}
