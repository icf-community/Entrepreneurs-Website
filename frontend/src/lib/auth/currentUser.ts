import type { AuthError, SupabaseClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════
// Foundry · Who is signed in, without a GoTrue round trip (B26)
//
// getUser() asks Supabase Auth on every call, and Auth shares the
// database's compute. At 250 signed-in members the proxy + page guard +
// action made ~3 of those per page and saturated a Medium-sized DB before
// any page data was read (E1b Stage 1, 2026-09-28: auth/user p50 8 s,
// 48% timeouts).
//
// getClaims() verifies the session JWT's signature locally against the
// project's published signing keys, cached process-wide by supabase-js.
// It still refreshes an expired session (and so still rewrites cookies in
// the proxy). On a project still on the legacy HS256 secret it falls back
// to getUser() by itself, so this is correct either way; it is only
// faster once asymmetric signing keys are on (owner: confirm in Supabase).
//
// What changes: a session revoked elsewhere ("sign out everywhere") keeps
// opening pages until its access token expires (at most an hour), exactly
// as it already keeps working against PostgREST. Bans do NOT wait: every
// gate still reads profiles.status from the database, and RLS enforces it.
// ════════════════════════════════════════════════════════════════════

// `providers` is the JWT's app_metadata.providers, fixed when the access token
// was issued; only /settings reads it (is there a password to change?).
export type AuthUser = { id: string; email: string | undefined; providers?: string[] };

export async function currentUser(
  supabase: SupabaseClient,
): Promise<{ user: AuthUser | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return { user: null, error };
  const { sub, email, app_metadata } = data.claims;
  if (typeof sub !== "string" || !sub) return { user: null, error: null };
  const providers = Array.isArray(app_metadata?.providers)
    ? app_metadata.providers.filter((p: unknown): p is string => typeof p === "string")
    : undefined;
  return { user: { id: sub, email: typeof email === "string" ? email : undefined, providers }, error: null };
}
