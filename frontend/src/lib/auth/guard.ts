import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";
import type { UserStatus } from "@/lib/database.overrides";
import { destinationForStatus, postApprovalDestination } from "@/lib/auth/status";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";

// Auth + onboarding-status gating used by every authenticated page.
// Centralised so swapping Supabase for a different backend later (e.g.
// a FastAPI service) only touches this one module instead of every
// page.tsx that gates by status.
//
// Returns the resolved user, profile status, and isAdmin flag so the
// caller can use them without re-querying. Pages that don't need any
// of those can ignore the return value.

export type GateOptions = {
  /**
   * If true, send approved-and-onboarding users straight through; do
   * not redirect on any status. Default false. Admins always pass
   * through regardless (mirrors existing behaviour so admins can
   * preview user-facing UIs for diagnostics).
   */
  passthrough?: boolean;
  /**
   * If true, also bounce an approved-but-not-yet-intaken member to
   * /intake — see postApprovalDestination. Only /home passes this: it
   * is the one page whose whole job is "where you land after signing
   * in", so it is the one place a first-time invitation belongs. Every
   * other approved page (settings, members, opportunities…) must stay
   * reachable regardless, or a member who deep-links in gets bounced
   * somewhere they didn't ask to go.
   */
  bounceToIntake?: boolean;
};

export type GateResult = {
  user: User;
  isAdmin: boolean;
  status: UserStatus | null;
  displayName: string;
  supabase: SupabaseClient<Database>;
};

/**
 * Same "full name, else preferred/first name, else a generic greeting"
 * rule home/page.tsx already used before this was centralised — kept
 * identical so every page's sidebar/greeting agrees. first_name is
 * NOT NULL on every real profile row, so the "there" fallback is only
 * ever reached when there is no profile row at all (requireSignedInUser,
 * pre-onboarding).
 */
/**
 * Where to send a signed-out visitor. Appends the page they were trying
 * to reach (from the x-pathname header set in lib/supabase/proxy.ts) as
 * ?next=, so a session that expired mid-visit — or a cold deep link —
 * lands back where it was after signing in, instead of always /home.
 *
 * The header is only ever set server-side from request.nextUrl, never
 * from anything a client sends, so there is nothing here for an attacker
 * to control; LoginClient.tsx still validates it again before using it,
 * since that is the side an open redirect would actually be exploited
 * from.
 */
async function loginRedirectPath(): Promise<string> {
  const path = (await headers()).get("x-pathname");
  return path ? `/login?next=${encodeURIComponent(path)}` : "/login";
}

export function computeDisplayName(
  profile: { first_name?: string | null; surname?: string | null; preferred_name?: string | null } | null,
): string {
  const name = profile?.preferred_name?.trim() || profile?.first_name?.trim() || "there";
  const fullName = [profile?.first_name, profile?.surname].filter(Boolean).join(" ");
  return fullName || name;
}

/**
 * Server-side gate for authenticated pages. Redirects:
 *  - no session → /login
 *  - non-admin with pending_onboarding → /onboarding
 *  - non-admin with pending_review → /pending
 *  - non-admin with rejected → /rejected
 *
 * Admins bypass status redirects so they can browse the user-facing UI.
 */
export async function requireApprovedUser(opts: GateOptions = {}): Promise<GateResult> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  // An outage is not a signed-out visitor: throw to the error page rather
  // than bouncing a signed-in member to a login form that will fail too.
  throwIfAuthUnreachable("session", authError);
  if (!user) redirect(await loginRedirectPath());

  const [adminRes, profileRes] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("profiles")
      .select("status, profile_version, intake_deferred_at, first_name, surname, preferred_name")
      .eq("id", user.id)
      .single(),
  ]);
  // Before either result is trusted: a failed is_admin would otherwise read
  // as "not an admin", and a failed profile read as "no profile".
  throwIfUnreachable("is_admin", adminRes);
  throwIfUnreachable("profile", profileRes);
  const profile = profileRes.data;

  const isAdmin = !!adminRes.data;

  // Now genuinely "no row" (PGRST116) or a rejected token — signed out.
  if (!profile) redirect(await loginRedirectPath());

  if (!opts.passthrough && !isAdmin && profile.status !== "approved") {
    redirect(destinationForStatus(profile.status));
  }

  if (opts.bounceToIntake && profile.status === "approved") {
    const dest = postApprovalDestination({
      profileVersion: profile.profile_version,
      intakeDeferredAt: profile.intake_deferred_at,
      isAdmin,
    });
    if (dest) redirect(dest);
  }

  return {
    user,
    isAdmin,
    status: profile.status as GateResult["status"],
    displayName: computeDisplayName(profile),
    supabase,
  };
}

/**
 * Server-side gate for pages that just need any authenticated user
 * regardless of onboarding status (e.g. /settings, /onboarding).
 * Redirects to /login if not signed in.
 */
export async function requireSignedInUser(): Promise<GateResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  // An outage is not a signed-out visitor: throw to the error page rather
  // than bouncing a signed-in member to a login form that will fail too.
  throwIfAuthUnreachable("session", authError);
  if (!user) redirect(await loginRedirectPath());

  const [adminRes, profileRes] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("profiles")
      .select("status, first_name, surname, preferred_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  throwIfUnreachable("is_admin", adminRes);
  throwIfUnreachable("profile", profileRes);
  const profile = profileRes.data;

  return {
    user,
    isAdmin: !!adminRes.data,
    status: (profile?.status ?? null) as GateResult["status"],
    displayName: computeDisplayName(profile),
    supabase,
  };
}
