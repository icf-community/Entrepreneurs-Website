import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";
import { reportIfCapped } from "@/lib/supabase/rowCap";
import { throwIfUnreachable } from "@/lib/supabase/unavailable";

// ════════════════════════════════════════════════════════════════════
// Foundry · The read path, once instead of at every call site
//
// lib/listings/{registry,user,admin}.ts did this for writes. This is the
// same move for reads, which never got it: every page talked to Supabase
// directly and re-did the same four things by hand.
//
//   * log the error and fall back to []      — 28 sites across 13 files
//   * remember reportIfCapped()              — 15 sites
//   * hand-write the snake_case row type     — 7 copies
//   * hand-write the camelCase mapper        — 12 copies, 2 identical
//
// Two of those were not merely repetitive.
//
// 1. THE HAND-WRITTEN ROW TYPES DEFEATED THE GENERATED ONES. Pages cast
//    with `(res.data ?? []) as RpcRow[]` where RpcRow was typed out by
//    hand — while database.types.ts already described that row exactly.
//    The cast is what broke the chain: rename a column in a migration and
//    the build stayed green while the field read `undefined` at runtime.
//    Inferring the row type instead is the entire integrity argument for
//    this file.
//
// 2. reportIfCapped WAS A THING YOU HAD TO REMEMBER, and it had already
//    been forgotten on six pages (retro-fitted in #41). Applying it here
//    turns a convention into a property: a new list page cannot get
//    silent 1000-row truncation by forgetting a line.
//
// WHY A THUNK AND NOT AN RPC NAME. Same reasoning as registry.ts's
// closures: a name-plus-args API has to build its arguments dynamically,
// which forces an untyped Record<string, unknown> somewhere — exactly how
// submitEvent once drifted from its schema. Passing the call itself keeps
// supabase-js checking it against the generated types, needs no cast in
// here, and works for `.from()` chains as well as `.rpc()`.
// ════════════════════════════════════════════════════════════════════

/** The server-side Supabase client every read in here takes. */
export type Db = SupabaseClient<Database>;

/**
 * The shape both `.rpc()` and `.from().select()` resolve to. Declared
 * structurally rather than imported so a thunk can hand back either.
 */
type ListResponse<T> = {
  data: T[] | null;
  error: PostgrestError | null;
  /** HTTP status; 0 when the request never got an answer. */
  status?: number;
};

/**
 * What a one-row query resolves to, loose enough to infer from.
 *
 * `rows()` above can name its payload as `T[]`, because an array only
 * matches the success branch of PostgrestSingleResponse and TS therefore
 * has one candidate for T. A single row has no such shape to bite on: ask
 * TS to infer T from `data: T | null` and both branches of the union are
 * candidates, `null` included, and it settles on `never` — at which point
 * every field access on the result is an error. Naming the whole response
 * instead and reading `.data` back off it sidesteps the inference
 * entirely.
 */
type SingleLike = { data: unknown; error: PostgrestError | null; status?: number };

/**
 * Run a list query. Reports if the result came back at PostgREST's row cap.
 *
 * TWO KINDS OF FAILURE, TWO BEHAVIOURS (S2, 2026-09-23):
 *
 *   * Supabase unreachable — network error, timeout, 5xx, 429. THROWS
 *     ServiceUnavailableError, so the page renders its error boundary with
 *     a working "Try again". This used to degrade to `[]` too, which meant
 *     an outage rendered "No members yet" as if it were true — and a
 *     cached() loader could pin that empty list for everyone.
 *   * Anything else (a 4xx: a missing grant, a bad argument). Logs, reports
 *     and degrades to `[]` as before. That is a code bug in one section, and
 *     one broken section should not take the whole page down with it.
 *
 * @param source Name of the query, for the log line and the cap report.
 *               Use the RPC or table name, e.g. "list_approved_events".
 */
export async function rows<T>(
  source: string,
  run: () => PromiseLike<ListResponse<T>>,
): Promise<T[]> {
  const res = await run();
  throwIfUnreachable(source, res);
  const { data, error } = res;
  if (error) {
    console.error(`Failed to load ${source}:`, error);
    Sentry.captureException(error, { tags: { surface: "data-read", source } });
    return [];
  }
  return reportIfCapped(source, data ?? []);
}

/**
 * Run a query expected to return one row or none (`.single()`,
 * `.maybeSingle()`, or a scalar-returning RPC). No cap check — there is
 * no cap to hit. Same two failure behaviours as rows(): unreachable
 * throws, so a detail page shows the error page rather than a 404.
 */
export async function maybeRow<R extends SingleLike>(
  source: string,
  run: () => PromiseLike<R>,
): Promise<NonNullable<R["data"]> | null> {
  const res = await run();
  throwIfUnreachable(source, res);
  const { data, error } = res;
  if (error) {
    console.error(`Failed to load ${source}:`, error);
    Sentry.captureException(error, { tags: { surface: "data-read", source } });
    return null;
  }
  return (data ?? null) as NonNullable<R["data"]> | null;
}
