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

export type CacheKey =
  | "directoryFacets" | "directoryFirstPage" | "directoryNewest"
  | "vcs" | "lookups" | "skills" | "skillsDetailed" | "sectors" | "siteBanner"
  | "adminConnectionStats";

const key = (k: CacheKey) => `cache:v${VERSION}:${k}`;

// S0: a load that started before a write must not store what it read
// after the write's invalidate() ran — that pinned the old value for the
// whole TTL. invalidate() bumps a per-key generation; a load notes the
// generation before it queries and its write-back is a compare-and-set
// that only stores while the generation is unchanged.
const genKey = (k: CacheKey) => `cache:v${VERSION}:gen:${k}`;
const lockKey = (k: CacheKey) => `cache:v${VERSION}:lock:${k}`;
const SET_IF_UNCHANGED =
  "local g = redis.call('GET', KEYS[2]) " +
  "if (g == false and ARGV[2] == '') or g == ARGV[2] then " +
  "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3]) return 1 end return 0";

// Keys whose loader is expensive enough that every instance missing at
// once is a database spike (the facets query is the slowest directory
// read). One instance loads; the others wait briefly for its result.
const SLOW: ReadonlySet<CacheKey> = new Set(["directoryFacets"]);
const PEER_WAIT_STEPS = 6;
const PEER_WAIT_STEP_MS = 100;
const FILL_LOCK_MS = 3_000;

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
  // leaves or edits their profile.
  directoryFacets: 300,
  // Two FIXED directory reads, not the paginated result space: the
  // unfiltered first page of /members and the five newest members on
  // /home. With search and six filters the full key space is unbounded,
  // but these two are what nearly every visit asks for, and each was a
  // whole-directory count-and-sort (~8ms at 5k members). Both are
  // identical for every member. Short TTL because they carry names and
  // bios, and they are dropped together with directoryFacets — see
  // LINKED below — so every existing directory write path clears them.
  directoryFirstPage: 60,
  directoryNewest: 60,
  vcs: 300,
  lookups: 3600,
  // Skills/sectors are a seeded taxonomy a human edits by migration — see
  // lib/data/taxonomy.ts's own header — so an hour-long TTL costs nothing
  // and this is exactly the "byte-identical for every member" case this
  // file's own header describes as the intended use.
  skills: 3600,
  skillsDetailed: 3600,
  sectors: 3600,
  // The incident banner (F-x4). Publishing and clearing invalidate it; the
  // TTL only bounds a missed invalidation, and /api/banner adds 15s of CDN
  // caching on top.
  siteBanner: 60,
  // Three whole-network aggregates for /admin/connections (D1: ~200 ms at
  // 5k members and 220k connections, growing with the edge count). The
  // exception to "admins never populate a shared key": this key is read
  // only by that admin page, the RPC refuses non-admins, and the value
  // holds no per-member data. Nothing invalidates it; a statistic ten
  // minutes old is fine.
  adminConnectionStats: 600,
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
  if (opts.skip) return loader();
  if (!redis || breakerOpen()) return fill(name, loader, isCacheable);

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

  return fill(name, loader, isCacheable);
}

// Loads in flight in this process, one per key (E1b). A shared key holds
// the same value for every member, so a request that misses while another
// is already loading it waits for that load instead of starting its own.
// Without this a cold key, or a cache the breaker has paused, sent every
// concurrent request to the database at once: at 250 members that was the
// 1.4 s facets query, 526 times in four minutes. Admin reads (skip) never
// come through here.
const inFlight = new Map<CacheKey, Promise<unknown>>();

function fill<T>(name: CacheKey, loader: () => Promise<T>, isCacheable: (value: T) => boolean): Promise<T> {
  const running = inFlight.get(name);
  if (running) return running as Promise<T>;
  const load = (async () => {
    const live = redis && !breakerOpen() ? redis : null;
    // Read before the query, so a write that commits during it is seen as
    // a changed generation. Unknown (Redis slow or down) means don't store.
    const before = live ? await readGeneration(live, name) : null;
    let holdsLock = false;
    if (live && SLOW.has(name)) {
      const peer = await waitForPeer<T>(live, name);
      if (peer.value !== undefined) return peer.value;
      holdsLock = peer.holdsLock;
    }
    const value = await loader();
    // One write per load, not one per waiter. after() runs it once the
    // response has been sent, so populating the cache never shows up in the
    // user's time-to-first-byte: awaiting it here would make the first
    // visitor after an invalidation pay for everyone else's speed-up.
    if (live && before !== null && isCacheable(value)) {
      after(async () => {
        try {
          await live.eval(SET_IF_UNCHANGED, [key(name), genKey(name)],
            [JSON.stringify(value), before, String(TTL_SECONDS[name])]);
          if (holdsLock) await live.del(lockKey(name));
        } catch (e) {
          noteFailure(`write failed for ${name}`, e);
        }
      });
    }
    return value;
  })().finally(() => inFlight.delete(name));
  inFlight.set(name, load);
  return load;
}

async function readGeneration(r: Redis, name: CacheKey): Promise<string | null> {
  try {
    const g = await withDeadline(r.get<string | number>(genKey(name)), READ_TIMEOUT_MS);
    return g === null || g === undefined ? "" : String(g);
  } catch (e) {
    noteFailure(`generation read failed for ${name}`, e);
    return null;
  }
}

/**
 * Take the fill lock, or wait up to ~600ms for the instance holding it to
 * store the value. Never blocks longer than that: past it, load anyway —
 * a duplicate query is better than a slow page.
 */
async function waitForPeer<T>(r: Redis, name: CacheKey): Promise<{ value?: T; holdsLock: boolean }> {
  try {
    const got = await withDeadline(r.set(lockKey(name), "1", { nx: true, px: FILL_LOCK_MS }), READ_TIMEOUT_MS);
    if (got === "OK") return { holdsLock: true };
    for (let i = 0; i < PEER_WAIT_STEPS; i++) {
      await new Promise((resolve) => setTimeout(resolve, PEER_WAIT_STEP_MS));
      const hit = await withDeadline(r.get<T>(key(name)), READ_TIMEOUT_MS);
      if (hit !== null && hit !== undefined) return { value: hit, holdsLock: false };
    }
  } catch (e) {
    noteFailure(`fill lock failed for ${name}`, e);
  }
  return { holdsLock: false };
}

/**
 * Drop cached entries. Called from the write paths — see
 * lib/listings/admin.ts and lib/listings/user.ts — so an approval or an
 * edit is visible immediately rather than at the end of a TTL.
 */
/**
 * Keys that must go whenever another does. Every directory write path
 * (admin approvals and removals, profile and onboarding saves via
 * invalidateDirectoryCache, graduate cleanup) already invalidates
 * directoryFacets; the cached card lists hold the same people, so they
 * ride on that rather than on twenty call sites remembering two more keys.
 */
const LINKED: Partial<Record<CacheKey, CacheKey[]>> = {
  directoryFacets: ["directoryFirstPage", "directoryNewest"],
};

export async function invalidate(...requested: CacheKey[]): Promise<void> {
  const names = [...new Set(requested.flatMap((n) => [n, ...(LINKED[n] ?? [])]))];
  if (!redis || names.length === 0) return;
  try {
    // Awaited, unlike the write: correctness beats latency here. The
    // revalidatePath() that follows can trigger a re-render, and that
    // render must not be able to read the entry we are deleting.
    // Deliberately not behind the breaker either — dropping a stale key
    // matters more than conserving commands.
    // The generation bump is what stops a load already in flight from
    // writing the old value back (see SET_IF_UNCHANGED).
    const p = redis.pipeline();
    p.del(...names.map(key));
    for (const n of names) p.incr(genKey(n));
    await p.exec();
  } catch (e) {
    // Worst case the TTL expires it. Log rather than fail the write —
    // the user's action has already committed at this point.
    noteFailure(`invalidation failed for ${names.join(", ")}`, e);
  }
}
