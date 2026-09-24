import { AuthUnknownError, isAuthRetryableFetchError } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════
// Foundry · "Supabase is unreachable" is not "you are signed out"
//
// Every page gate used to read `const { data: { user } } = getUser()` and
// redirect to /login when `user` was null — and `user` is also null when
// Auth simply could not be reached. Under load that bounced signed-in
// members to a login form that then failed too. Data reads had the twin
// problem: a down database rendered "No members yet" as a valid page.
//
// The two libraries already say which failure is which; these helpers
// only read it. Verified against the installed versions (2.106.2):
//
//   auth-js     network error or 502/503/504/52x → AuthRetryableFetchError
//               other 5xx                        → AuthApiError, status ≥ 500
//               unparseable response             → AuthUnknownError
//               no session / bad token           → 400 / 401 / 403 (signed out)
//   postgrest   network error or abort           → { status: 0 }
//               PostgREST / gateway failure      → status ≥ 500 (57014 → 500,
//                                                  PGRST003 → 504)
//               no row from .single()            → PGRST116, 406 (not infra)
//
// 429 counts as infrastructure on both sides. GoTrue rate-limits token
// refresh, and Vercel's egress IPs are shared: a 429 there is Foundry
// being busy, not the member being signed out.
//
// Nothing here reports to Sentry. A throw during render already reaches
// it through onRequestError (instrumentation.ts); the few call sites that
// catch ServiceUnavailableError instead report it themselves.
// ════════════════════════════════════════════════════════════════════

export class ServiceUnavailableError extends Error {
  constructor(source: string) {
    super(`Supabase unreachable while loading ${source}`);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * By name, not instanceof: a duplicated module (bundler chunking, test
 * module resets) makes a second copy of the class, and instanceof would
 * then let a real outage escape as an unhandled error.
 */
export function isServiceUnavailable(e: unknown): boolean {
  return e instanceof Error && e.name === "ServiceUnavailableError";
}

export function isInfraStatus(status: number | undefined): boolean {
  return status !== undefined && (status === 0 || status === 429 || status >= 500);
}

export function isInfraAuthError(error: unknown): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error) || error instanceof AuthUnknownError) return true;
  return isInfraStatus((error as { status?: number }).status);
}

/** Throw if a PostgREST response failed because Supabase could not answer. */
export function throwIfUnreachable(source: string, res: { status?: number; error: unknown }): void {
  if (res.error && isInfraStatus(res.status)) throw new ServiceUnavailableError(source);
}

/** Throw if getUser()'s error is an outage rather than a missing session. */
export function throwIfAuthUnreachable(source: string, error: unknown): void {
  if (isInfraAuthError(error)) throw new ServiceUnavailableError(source);
}

/**
 * A fetch that gives up after `ms`. Both libraries turn the resulting
 * abort into their infrastructure shape (status 0 /
 * AuthRetryableFetchError), so a stalled connection reaches the error
 * page instead of spinning until the platform kills the function.
 */
export function fetchWithTimeout(ms: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}

export const UNREACHABLE_MESSAGE = "We couldn't reach the server — please try again in a moment.";
