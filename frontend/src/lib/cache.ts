import "server-only";
import { after } from "next/server";
import { Redis } from "@upstash/redis";
import * as Sentry from "@sentry/nextjs";

// ════════════════════════════════════════════════════════════════════
// Foundry · Read-through cache (Upstash Redis)
//
// The app renders with `dynamic = "force-dynamic"` (the nonce CSP needs
// it), so Next's own route and data caches are off. This is the layer
// that puts something between a page render and Supabase.
//
// WHAT MAY BE CACHED HERE — read this before adding a key.
//
// Only responses that are byte-identical for every member. Several of
// this app's RPCs are deliberately caller-dependent:
// list_approved_opportunities and list_approved_events return
// contact_email only when the row is marked visible OR the caller is the
// poster OR the caller is an admin (migration 20260530000002). Caching
// one member's response and serving it to another would disclose
// posters' private contact addresses. Those lists are therefore NOT
// cached here, and anything per-user (bookmarks, listing actions,
// submissions) obviously isn't either.
//
// QUOTA COUPLING — READ THIS BEFORE ADDING CACHE TRAFFIC.
//
// This runs in one of two configurations, and which one is live is a
// deployment fact, not something this file can assert. `cacheSharesRateLimitDb`
// below is the runtime answer; instrumentation.ts prints it at boot.
//
//   SPLIT (UPSTASH_CACHE_REDIS_REST_URL/TOKEN set) — the cache has its
//   own database. There is no quota coupling, and the residual risk is
//   spend, not lockout. This is the correct production setup.
//
//   SHARED (those unset) — the cache falls back to the rate limiter's
//   instance, because that is the one the project is guaranteed to have.
//   The two then draw on one command quota, and the `submit` bucket
//   fails CLOSED, so spending the quota on cache traffic starts refusing
//   listing submissions and contact-form messages. A cache problem
//   becomes a submissions outage.
//
// Splitting needs a second Upstash database, which the free tier does not
// allow (one database, 500K commands a month); it means pay-as-you-go
// ($0.20 per 100K commands — the extra database itself is free up to ten).
//
// The three mitigations below exist for the SHARED case and are load-bearing
// only there. They are not a substitute for a second database — they make
// the failure survivable and audible, which is a different claim:
//
//   * the breaker below, which stops calling Redis after repeated
//     failures so a spent quota leaves what's left to the limiter;
//   * the boot warning in instrumentation.ts;
//   * lib/ratelimit.ts's `unavailable` decision and in-process fallback,
//     so that if the quota does go, the refusal says so instead of
//     telling members they are posting too fast.
//
// LATENCY. A cache only helps if it answers faster than the query it is
// standing in front of, and the directory query is ~22ms at 1,200
// members — not a high bar for a cross-region Redis hop to miss. So the
// read is on a deadline (READ_TIMEOUT_MS) and the write is handed to
// after(), which runs it once the response has been sent. Neither can
// put Upstash's latency on the user's critical path.
//
// Every failure mode here degrades to "go to Supabase". A cache outage
// slows the app down; it never breaks or falsifies it.
// ════════════════════════════════════════════════════════════════════

// `||`, not `??`: an empty string set for either var must fall through to
// the shared one exactly like unset does, or `??` would treat "" as
// "present", hand Redis an empty URL/token, and fail every call — a
// misconfiguration that should degrade to SHARED instead reads as the
// cache being down. `cacheDedicatedUrl` is kept as its own value (not
// re-derived from `url` below) so cacheSharesRateLimitDb reads the exact
// thing that decided the fallback, rather than a second env lookup that
// could drift from it.
const cacheDedicatedUrl = process.env.UPSTASH_CACHE_REDIS_REST_URL || undefined;
const url = cacheDedicatedUrl ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_CACHE_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const cacheEnabled = Boolean(url && token);

/** True when the cache is sharing the rate limiter's database. */
export const cacheSharesRateLimitDb = cacheEnabled && !cacheDedicatedUrl;

const redis = cacheEnabled ? new Redis({ url: url!, token: token! }) : null;

/**
 * How long to wait for Redis before giving up and querying Supabase
 * instead. Generous enough for a cross-region hop, small enough that a
 * degraded cache can't add more latency than the query it replaces.
 */
const READ_TIMEOUT_MS = 100;

/**
 * After this many consecutive failures the cache stops calling Redis for
 * a cooldown. Two reasons. The first applies only in the SHARED
 * configuration (see the header): there the `submit` bucket fails CLOSED
 * on the same database, so cache traffic burning through the command
 * quota would start refusing submissions, and backing off leaves the
 * remaining budget to the limiter. The second applies always — there is
 * no sense paying the timeout on every render while Redis is unhealthy.
 */
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30_000;

let consecutiveFailures = 0;
let breakerOpenUntil = 0;

function breakerOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}

function noteFailure(what: string, e: unknown): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    consecutiveFailures = 0;
    console.warn(
      `cache: ${BREAKER_THRESHOLD} consecutive failures — pausing Redis for ` +
        `${BREAKER_COOLDOWN_MS / 1000}s so the rate limiter keeps its quota`,
    );
    // Only on the trip itself (once per cooldown window, not per failed
    // call). In the SHARED configuration a sustained outage here is the
    // leading indicator of the `submit` bucket's own fail-closed refusals
    // about to start; in the SPLIT one it is "the cache is down, renders
    // got slower". Either way console.warn alone is invisible outside
    // Vercel's own logs.
    Sentry.captureMessage("cache: circuit breaker tripped — pausing Redis reads/writes", {
      level: "warning", tags: { surface: "cache" },
    });
  }
  console.warn(`cache: ${what}`, e);
}

/**
 * Only the read path clears the streak. A write or a delete succeeding
 * says nothing about whether reads are healthy, and both run off the
 * critical path — letting them reset the counter meant a Redis that was
 * timing out on reads but accepting writes would never trip the breaker,
 * which is precisely the slow-cache case this exists to stop.
 */
function noteReadSuccess(): void {
  consecutiveFailures = 0;
}

/** Rejects rather than hanging, so a slow Redis can't stall a render. */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Bump to invalidate every key at once. Cheaper and more reliable than
 * hunting down stale keys after a shape change: a mapper edit that
 * changes the cached JSON only needs this number incremented.
 */
const VERSION = 1;

export type CacheKey = "directoryFacets" | "vcs" | "lookups" | "skills" | "skillsDetailed" | "sectors";

const key = (k: CacheKey) => `cache:v${VERSION}:${k}`;

/**
 * TTLs are the safety net, not the mechanism. Writes invalidate
 * explicitly (see invalidate() and its callers); these bound how long a
 * *missed* invalidation can show stale data. Kept short for the
 * directory because profile edits are written client-side, straight to
 * the RPC, with no server action able to bust the key.
 */
const TTL_SECONDS: Record<CacheKey, number> = {
  // Facets are the distinct courses / sectors / skills and the graduation-year
  // bounds — a couple of hundred bytes that change only when someone joins,
  // leaves or edits their profile. The paginated result pages themselves are
  // not cached: with search and six filters the key space is effectively
  // unbounded, and each page is now a ~3ms indexed query anyway.
  directoryFacets: 300,
  vcs: 300,
  lookups: 3600,
  // Skills/sectors are a seeded taxonomy a human edits by migration — see
  // lib/data/taxonomy.ts's own header — so an hour-long TTL costs nothing
  // and this is exactly the "byte-identical for every member" case this
  // file's own header describes as the intended use.
  skills: 3600,
  skillsDetailed: 3600,
  sectors: 3600,
};

/**
 * Read-through. Returns the cached value if present, otherwise runs the
 * loader, stores the result and returns it.
 *
 * The loader's result is stored only if it looks like real data — an
 * empty array is far more often a transient Supabase error (the loaders
 * log and fall back to []) than a genuinely empty table, and caching
 * that would pin an empty page in front of every member for the TTL.
 */
export async function cached<T>(
  name: CacheKey,
  loader: () => Promise<T>,
  opts: {
    /**
     * Bypass the cache entirely for this call — neither read nor write.
     * Used for admin requests: RLS can show an admin rows a member can't,
     * so an admin must never be the one who populates a shared key. The
     * current queries all filter by status explicitly and so return the
     * same rows either way, but that is a property of today's queries and
     * not something a future edit should have to remember.
     */
    skip?: boolean;
    isCacheable?: (value: T) => boolean;
  } = {},
): Promise<T> {
  const isCacheable = opts.isCacheable ?? (() => true);
  if (!redis || opts.skip || breakerOpen()) return loader();

  try {
    const hit = await withDeadline(redis.get<T>(key(name)), READ_TIMEOUT_MS);
    if (hit !== null && hit !== undefined) {
      noteReadSuccess();
      return hit;
    }
    noteReadSuccess();
  } catch (e) {
    // A slow or failing read is not a reason to fail, or delay, the page.
    noteFailure(`read failed for ${name}`, e);
  }

  const value = await loader();

  if (isCacheable(value)) {
    // after() runs this once the response has been sent, so populating the
    // cache never shows up in the user's time-to-first-byte. Awaiting it
    // here would make the *first* visitor after an invalidation pay for
    // everyone else's speed-up.
    after(async () => {
      try {
        await redis.set(key(name), value, { ex: TTL_SECONDS[name] });
      } catch (e) {
        noteFailure(`write failed for ${name}`, e);
      }
    });
  }
  return value;
}

/**
 * Drop cached entries. Called from the write paths — see
 * lib/listings/admin.ts and lib/listings/user.ts — so an approval or an
 * edit is visible immediately rather than at the end of a TTL.
 */
export async function invalidate(...names: CacheKey[]): Promise<void> {
  if (!redis || names.length === 0) return;
  try {
    // Awaited, unlike the write: correctness beats latency here. The
    // revalidatePath() that follows can trigger a re-render, and that
    // render must not be able to read the entry we are deleting.
    // Deliberately not behind the breaker either — dropping a stale key
    // matters more than conserving commands.
    await redis.del(...names.map(key));
  } catch (e) {
    // Worst case the TTL expires it. Log rather than fail the write —
    // the user's action has already committed at this point.
    noteFailure(`invalidation failed for ${names.join(", ")}`, e);
  }
}
