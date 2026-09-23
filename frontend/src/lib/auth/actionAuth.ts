import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { isInfraAuthError, isInfraStatus, isServiceUnavailable, UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";
import type { UserStatus } from "@/lib/database.overrides";

// Auth context for server *actions* (not pages). Pages use guard.ts's
// requireApprovedUser, which redirect()s on failure — wrong for a form
// submit, where we want to return an err Result and show it inline.
//
// This returns the resolved identity so each action can decide what it
// needs (signed-in vs approved vs admin) and return a clean error.
//
// `unreachable` is set when Supabase could not answer (S2). Callers must
// check it BEFORE `!user`: otherwise an outage reads as "You must be
// signed in", which blames the member and sends them to a login that will
// fail too. It is reported to Sentry here, once, because unlike a page
// render nothing throws and onRequestError never sees it.

export type ActionAuth = {
  supabase: SupabaseClient<Database>;
  user: User | null;
  isAdmin: boolean;
  status: UserStatus | null;
  unreachable: boolean;
};

function unreachableAuth(supabase: SupabaseClient<Database>, what: string, error: unknown): ActionAuth {
  Sentry.captureException(error, { level: "warning", tags: { surface: "infra-unavailable", source: what } });
  return { supabase, user: null, isAdmin: false, status: null, unreachable: true };
}

export async function getActionAuth(): Promise<ActionAuth> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (isInfraAuthError(authError)) return unreachableAuth(supabase, "session", authError);
  if (!user) return { supabase, user: null, isAdmin: false, status: null, unreachable: false };

  const [adminRes, profileRes] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.from("profiles").select("status").eq("id", user.id).maybeSingle(),
  ]);
  if (adminRes.error && isInfraStatus(adminRes.status)) return unreachableAuth(supabase, "is_admin", adminRes.error);
  if (profileRes.error && isInfraStatus(profileRes.status)) return unreachableAuth(supabase, "profile", profileRes.error);

  return {
    supabase,
    user,
    isAdmin: !!adminRes.data,
    status: (profileRes.data?.status ?? null) as ActionAuth["status"],
    unreachable: false,
  };
}

// Explicit admin gate for admin-only server actions. The underlying
// SECURITY DEFINER RPCs already enforce is_admin(); this is defence in
// depth + a clean error message instead of a raw RPC exception leaking
// to a non-admin caller.
export async function requireAdmin(): Promise<
  { ok: true; supabase: SupabaseClient<Database> } | { ok: false; error: string }
> {
  const { user, isAdmin, supabase, unreachable } = await getActionAuth();
  if (unreachable) return { ok: false, error: UNREACHABLE_MESSAGE };
  if (!user) return { ok: false, error: "You must be signed in." };
  if (!isAdmin) return { ok: false, error: "Admin access required." };
  return { ok: true, supabase };
}

/**
 * For a server action that calls a page reader (lib/data/*): those throw
 * ServiceUnavailableError when Supabase cannot answer, and a throw out of
 * a server action surfaces as nothing at all — the button just stops.
 * `.catch(unreachableAsNull)` turns exactly that one error into `null` so
 * the action can return its own "couldn't reach the server" Result;
 * anything else still throws.
 */
export function unreachableAsNull(e: unknown): null {
  if (isServiceUnavailable(e)) {
    Sentry.captureException(e, { level: "warning", tags: { surface: "infra-unavailable" } });
    return null;
  }
  throw e;
}
