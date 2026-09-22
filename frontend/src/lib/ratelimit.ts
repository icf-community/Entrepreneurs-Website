import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { isCloudflareIp } from "@/lib/cloudflareIps";
import * as Sentry from "@sentry/nextjs";

// ════════════════════════════════════════════════════════════════════
// Upstash rate limiting — app layer (precision). Cloudflare's edge is
// the flood/DDoS shield; this is per-identity abuse control.
//
// ENV-GATED: with no UPSTASH_REDIS_REST_* env, every check returns
// success=true, so local dev, CI, `next build`, and unconfigured
// deploys behave exactly as before. It only "turns on" once the two
// env vars are set.
//
// NAT: Imperial students on campus share one public IP, so an IP bucket
// is a campus bucket. Mutations are therefore keyed on the signed-in user
// wherever there is one — abuse belongs to an account, not to a building.
// Only genuinely anonymous traffic falls back to IP, and it gets its own
// far higher ceiling because that key stands for thousands of people.
// ════════════════════════════════════════════════════════════════════

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const rateLimitEnabled = Boolean(url && token);

const redis = rateLimitEnabled ? new Redis({ url: url!, token: token! }) : null;

export type RateBucket =
  | "mutations"
  | "anonMutations"
  | "submit"
  | "communityPost"
  | "communityUpload"
  | "postReport"
  | "avatarUpload"
  | "cvUpload"
  | "githubConnect"
  | "githubShowcase"
  | "connectionRequest"
  | "connectionRespond"
  | "otpVerify";

// ─── Key namespace ──────────────────────────────────────────────────
//
// UPSTASH_REDIS_REST_URL/TOKEN are scoped to Production AND Preview in
// Vercel, so both environments limit against ONE database, and a bucket
// key is prefix + identifier (a user id, usually). Without a namespace a
// preview deploy writes into production's counters for the same person:
// connect GitHub three times on a preview and the 3-per-24h githubConnect
// budget is spent on the real site too.
//
// It fails STRICT rather than loose — sharing a counter can only exhaust
// an allowance sooner, never grant more — which is why this is a
// papercut and not a hole. It stops being a papercut the moment a
// preview URL is handed to members for feedback, because then their
// production budgets are what preview traffic is spending, otpVerify
// (fail-closed, the sign-in path) included.
//
// Production deliberately keeps the BARE prefix it has always used, so
// adding this cannot reset a live counter. Only non-production
// deployments gain a segment. VERCEL_ENV is set by Vercel itself and is
// already load-bearing in instrumentation.ts; nothing new to configure.
const NS = process.env.VERCEL_ENV === "production" ? "" : `${process.env.VERCEL_ENV ?? "dev"}:`;

/** Bucket key prefix. Always build prefixes through this — two buckets
 *  sharing a literal silently merge their limits. */
const p = (name: string) => `rl:${NS}${name}`;

// Factory per bucket. slidingWindow chosen for smooth limiting; analytics
// off to keep the command count (and cost) down.
const BUCKETS: Record<RateBucket, () => Ratelimit> = {
  // Per-user backstop on all non-GET requests (server actions are POSTs).
  // 60/min is far more than one person generates by hand, and because the
  // key is an account it no longer collides with everyone else on campus.
  mutations: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(60, "1 m"), prefix: p("mut"), analytics: false }),
  // Anonymous non-GET traffic, keyed on IP because there is no better
  // identity. One key can stand for the whole campus — a signup wave after
  // an announcement is the case that matters — so the ceiling is a flood
  // guard, not a per-person limit. Cloudflare absorbs real floods at the
  // edge; Turnstile and Supabase's own auth limits are the precise controls
  // on the sensitive anonymous endpoints.
  //
  // RAISED 300 → 1200 (2026-09-08). Imperial's campus NAT means every
  // student on college wifi shares ONE public IP, so this single bucket is
  // the whole university's budget, and 300/min could not survive the event
  // this app exists for. Onboarding is a multi-step server action at ~5
  // POSTs per signup; a launch talk realistically spikes at 200–400
  // signups in the first ten minutes, so 100–200/min sustained with bursts
  // to roughly double. At 300 the site would 429 partway through the
  // announcement, telling students to "slow down" while the room is being
  // told to sign up — indistinguishable from the site falling over.
  //
  // 1200 is ~4× that worst case, and caps a single host at 20 requests a
  // second. 3000 was tried first and rejected as unnecessary: it is ~10×
  // what the event needs, and a host sustaining it costs 4.3M Vercel
  // invocations a day. Headroom the traffic never uses is only exposure.
  //
  // What this bucket is NOT: DDoS protection. It runs in Next.js
  // middleware (supabase/proxy.ts), so the request has already consumed a
  // Vercel invocation before it is counted — a 429 saves the route render,
  // not the invocation — and each check costs an Upstash round trip, so
  // under a flood it adds load rather than shedding it. A real attacker
  // also has thousands of source IPs, which leaves every per-IP bucket
  // empty. Edge defence is Cloudflare's job (rate-limiting rules, bot
  // fight mode, under-attack mode) and must not be assumed to live here.
  //
  // Nor is it the abuse control for the endpoints behind it: signup is
  // gated by Turnstile, Supabase Auth's per-email limits, and the
  // @imperial.ac.uk domain trigger; the contact form by Turnstile. Those
  // are precise and per-person. This is a coarse single-host flood guard,
  // and that is all it should be relied on to be.
  //
  // GET/HEAD never reach this code at all, so the bulk of event traffic —
  // people reading pages — is not rate limited on any key. Only mutations
  // are. If reads need shedding, that is Cloudflare and B3.1, not this.
  anonMutations: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(1200, "1 m"), prefix: p("mut:anon"), analytics: false }),
  // Precise per-user limit on listing/contact submissions.
  submit: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(10, "1 h"), prefix: p("sub"), analytics: false }),
  // Community posts. Its own bucket rather than sharing `submit`, because
  // posting to the feed should not consume the quota for posting a job.
  //
  // 10/day, and deliberately not also a tighter burst limit. One a day was
  // considered and rejected: it throttles hardest exactly the members
  // keeping a new feed alive, while the abuse case is a script, which
  // 10/day stops dead either way. A separate per-hour bucket was also
  // rejected — the `mutations` backstop above already caps any one account
  // at 60 POSTs/minute, so a burst check would spend Upstash commands (a
  // budget shared with the response cache on the free tier) to re-enforce
  // something already enforced.
  communityPost: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(10, "24 h"), prefix: p("post"), analytics: false }),
  // Report-bombing — one member mass-reporting someone they dislike — is a
  // real abuse vector, and a lower ceiling than posting because a member
  // with more than a handful of genuine reports in a day is an outlier
  // worth an admin noticing.
  postReport: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(5, "24 h"), prefix: p("rep"), analytics: false }),
  // Uploads get their own allowance rather than drawing on `communityPost`.
  // Sharing looked tidy and was wrong: a post with two images spent three
  // tokens, so the real ceiling for anyone who posts pictures was three a
  // day rather than the ten the limit advertises — and swapping an attached
  // image for a different one burned another token without ever publishing
  // anything. 40 covers ten two-image posts with room to change your mind,
  // and the ceiling that actually matters (how much reaches the feed) is
  // still `communityPost`.
  communityUpload: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(40, "24 h"), prefix: p("upl"), analytics: false }),
  // Avatar and CV uploads each get their own allowance rather than sharing
  // communityUpload — posting pictures to the feed and setting a profile
  // photo are unrelated activities, and lumping them would let a member
  // who posts a lot of images burn through their own avatar quota. 10/day
  // covers re-cropping and changing your mind several times over; the
  // abuse case either bucket guards against is a script, which 10/day
  // stops just as dead as 40/day does. No new database backstop is
  // needed alongside these — issue_upload_ticket's existing cap is 60
  // *outstanding* (unconsumed) tickets, global per member, and a normal
  // member never holds more than one unconsumed avatar ticket and one CV
  // ticket at a time, so it cannot be approached by traffic through
  // these two buckets alone.
  avatarUpload: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(10, "24 h"), prefix: p("ava"), analytics: false }),
  cvUpload: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(10, "24 h"), prefix: p("cv"), analytics: false }),
  // The two GitHub buckets exist because both actions behind them spend
  // money and worker time on someone else's behalf, which none of the
  // buckets above do. 20260908000002 stops the *duplicate* job — a second
  // press while one is already queued collapses into the first — but a
  // member who waits for each job to be claimed and then presses again
  // gets a fresh one every time, and that loop is unbounded without a
  // limit here. The database guard and this are guarding different things:
  // one stops accidental duplicates, this stops deliberate repetition.
  //
  // githubConnect is the tighter of the two because a scan is the more
  // expensive job (GitHub API pagination + a README fetch per repo + up to
  // three LLM calls) and because the worker runs ONE job at a time, so
  // repeated scans queue ahead of every other member's CV ingest. 5/day is
  // far above real use — connecting is a once-ever action for almost
  // everyone, and the ceiling only needs to leave room for a genuine
  // retry after a failure, plus switching accounts once or twice.
  githubConnect: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(3, "24 h"), prefix: p("ghc"), analytics: false }),
  // Editing your showcase must not feel rationed — the plan's standing
  // decision is that prompting is throttled and editing never is, and the
  // on-screen copy promises exactly that ("change them any time"). So this
  // is set where a member cannot notice it and a script cannot ignore it:
  // 20/hour is more saves in an hour than anyone makes deliberately, while
  // still capping a runaway client at 20 LLM calls instead of thousands.
  // Per hour rather than per day on purpose — a daily cap that a stuck
  // client burned through at 3am would lock the member out of their own
  // profile until midnight, which is the failure this bucket is supposed
  // to prevent, not cause.
  githubShowcase: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(10, "1 h"), prefix: p("ghs"), analytics: false }),
  // Connection requests. The AUTHORITATIVE cap is in the database —
  // connection_limits() gives send_connection_request 10/day, 25/week and
  // 30 outstanding, counted in the same transaction as the insert, so a
  // direct PostgREST call cannot bypass it. This bucket is the coarse
  // outer guard, and it is deliberately set ABOVE the configured daily
  // cap (15 vs 10) so the member always meets the RPC's specific, honest
  // message ("you've reached your daily limit of 10") rather than the
  // generic rate-limiter one. The gap is small enough that it is still a
  // real ceiling if the DB check is ever removed or bypassed: 15 requests
  // a day is nowhere near a harvesting rate.
  //
  // Per 24h rather than per hour, matching the DB window it shadows — an
  // hourly bucket would refuse a member who legitimately sends their
  // whole daily allowance after a careers evening.
  connectionRequest: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(15, "24 h"), prefix: p("conn:req"), analytics: false }),
  // Accept / decline / withdraw / remove / block / unblock. For all of
  // these but block, the ceiling is the size of your own inbox: they act
  // on a row the caller is already party to, so volume is not the abuse
  // surface and the bucket is only there to stop a runaway client.
  //
  // BLOCK IS THE EXCEPTION, and an earlier version of this comment was
  // wrong to lump it in. It takes an arbitrary member id and CREATES a
  // row from nothing, which is the same write-amplifier shape as send, so
  // it has its own authoritative database cap (`block_daily_cap`, 20/day,
  // in connection_limits()). This bucket sits deliberately above it for
  // the same reason connectionRequest sits above the send cap: the member
  // should meet the RPC's specific message, not the generic one.
  //
  // 100/day — far more than anyone clears by hand, and nothing near
  // enough to matter as a cost.
  connectionRespond: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(100, "24 h"), prefix: p("conn:res"), analytics: false }),
  // verifyOtp (student/alum login-signup codes, email-change confirmation)
  // runs on the browser Supabase client, straight to Supabase's REST
  // endpoint — it never passes through proxy.ts's `mutations` backstop and,
  // unlike every other auth call in this app, carries no captchaToken. This
  // is the only app-level throttle standing between a guessed target email
  // and unlimited 6-digit-code guesses. Keyed on the email being verified
  // (see verifyOtpGate.ts), not the caller, and generous enough for a
  // typo-prone human: 10 tries in 10 minutes.
  otpVerify: () =>
    new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(10, "10 m"), prefix: p("otp"), analytics: false }),
};

const instances = new Map<RateBucket, Ratelimit>();

function instance(bucket: RateBucket): Ratelimit | null {
  if (!redis) return null;
  let inst = instances.get(bucket);
  if (!inst) {
    inst = BUCKETS[bucket]();
    instances.set(bucket, inst);
  }
  return inst;
}

// Whether to allow a request when the limiter backend (Upstash) is
// unreachable. The coarse `mutations` backstop fails OPEN — a transient
// Redis blip must not take down all traffic. The security-sensitive
// `submit` bucket fails CLOSED — an outage must not become a way to bypass
// the per-user abuse limit on submissions.
//
// `communityPost` and `postReport` join `submit` on the fail-CLOSED side.
// They are abuse limits on an unmoderated, publish-immediately surface, so
// a Redis outage becoming an unlimited-posting window is the one outcome
// worth refusing traffic to avoid. NOTE: this is a list, not a default —
// a new bucket added without being named here silently fails OPEN.
// (steps.test-style guard: ratelimit.test.ts asserts every bucket is
// classified deliberately, so adding one forces that decision.)
//
// Since the in-process fallback landed (see checkLocal), being on this
// list no longer means "refuse on an outage" — it means "keep limiting,
// with a weaker per-instance limiter, rather than letting the ceiling
// disappear". The security property is unchanged; the member-facing
// failure mode is not.
// githubConnect and githubShowcase are on this list because what they
// guard is spend, and an Upstash outage is not a reason to hand out
// unmetered LLM calls. The in-process fallback below keeps them limited
// (loosely, per instance) rather than refusing, so no member is locked
// out of their own profile by a Redis blip.
// Both connection buckets fail CLOSED. What connectionRequest guards is
// email harvesting — the entire threat model of the connections feature —
// so an Upstash outage becoming an unmetered send window is precisely the
// outcome the list exists to prevent. connectionRespond joins it for a
// different reason: it is the one connections bucket with no database
// backstop underneath it, so if it fails open during an outage there is
// no ceiling at all. Neither can lock a member out the way otpVerify
// could: the in-process fallback keeps limiting at 15/day and 100/day per
// instance, both far above real use.
const FAIL_CLOSED: readonly RateBucket[] = [
  "submit", "communityPost", "communityUpload", "postReport", "avatarUpload", "cvUpload",
  "githubConnect", "githubShowcase", "connectionRequest", "connectionRespond", "otpVerify",
];

export function failOpen(bucket: RateBucket): boolean {
  return !FAIL_CLOSED.includes(bucket);
}

/**
 * Why this is three values and not a boolean.
 *
 * "limited" and "unavailable" are the same answer to the request and a
 * completely different answer to the person. `submit` fails CLOSED, so a
 * Redis outage — or a command quota spent, which on the free tier the
 * response cache shares (see lib/cache.ts) — refuses submissions while
 * telling the member they are posting too frequently. That message is
 * false, it blames them for an outage, and it gives whoever is on call
 * nothing to go on: the failure looks exactly like the feature working.
 *
 * Callers that fail closed should distinguish the two. Callers that fail
 * open can keep using allow() below.
 */
export type RateDecision = "allowed" | "limited" | "unavailable";

// ─── In-process fallback ────────────────────────────────────────────
//
// When Upstash is unreachable, every FAIL_CLOSED bucket refuses — and
// `otpVerify` is on that list, which means a Redis blip stops members
// SIGNING IN, with a message that wrongly blames them for going too fast.
// During the exact traffic spike this is all meant to survive, that is the
// worst possible failure: everyone is funnelled through /login.
//
// Flipping those buckets open is not the answer — an outage must not
// become an abuse window, which is precisely what the list is for. The
// answer is to stop "refuse" being the only alternative: fall back to a
// per-instance in-memory limiter with the same window. That is weaker
// than the shared one (a serverless deploy has N instances, so the real
// ceiling is up to N× the configured limit) but it is bounded, and
// bounded-but-loose beats locking out every legitimate member.
//
// Deliberately NOT a replacement for Upstash: memory is per-instance and
// dies with it, so this only ever runs on the error path.
const WINDOW_MS: Record<RateBucket, number> = {
  mutations: 60_000,
  anonMutations: 60_000,
  submit: 3_600_000,
  communityPost: 86_400_000,
  communityUpload: 86_400_000,
  postReport: 86_400_000,
  avatarUpload: 86_400_000,
  cvUpload: 86_400_000,
  githubConnect: 86_400_000,
  githubShowcase: 3_600_000,
  connectionRequest: 86_400_000,
  connectionRespond: 86_400_000,
  otpVerify: 600_000,
};

const LIMIT: Record<RateBucket, number> = {
  mutations: 60,
  anonMutations: 1200,
  submit: 10,
  communityPost: 10,
  communityUpload: 40,
  postReport: 5,
  avatarUpload: 10,
  cvUpload: 10,
  githubConnect: 3,
  githubShowcase: 10,
  connectionRequest: 15,
  connectionRespond: 100,
  otpVerify: 10,
};

type LocalEntry = { count: number; resetAt: number };
const localBuckets = new Map<string, LocalEntry>();
// Hard ceiling on the map so a flood of distinct identifiers during an
// outage cannot grow it without bound. Evicting the whole map is crude
// and correct here: it resets every window early, which errs toward
// allowing traffic, and this path only runs while Upstash is down.
const LOCAL_MAX_KEYS = 10_000;

export function checkLocal(bucket: RateBucket, identifier: string): RateDecision {
  const key = `${bucket}:${identifier}`;
  const now = Date.now();
  if (localBuckets.size > LOCAL_MAX_KEYS) localBuckets.clear();

  const entry = localBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    localBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS[bucket] });
    return "allowed";
  }
  entry.count += 1;
  return entry.count > LIMIT[bucket] ? "limited" : "allowed";
}

/** Test-only: the fallback map is module state and would otherwise leak
 *  counts between cases. */
export function __resetLocalBuckets(): void {
  localBuckets.clear();
}

// Allows everything when rate limiting is disabled (no Upstash env) — the
// documented local/CI behaviour.
export async function check(bucket: RateBucket, identifier: string): Promise<RateDecision> {
  const inst = instance(bucket);
  if (!inst) return "allowed";
  try {
    const { success } = await inst.limit(identifier);
    return success ? "allowed" : "limited";
  } catch (e) {
    // Swallowing this was the reason a fail-closed submission looked like a
    // rate limit. It is logged here for every bucket; the callers that fail
    // closed also report it, because for them it is an outage.
    console.error(`ratelimit: the "${bucket}" bucket is unreachable`, e);
    Sentry.captureException(e, {
      level: "error",
      tags: { surface: "ratelimit", bucket },
      extra: { note: "Upstash unreachable — falling back to the in-process limiter" },
    });

    // Fail-open buckets never needed a decision here; the caller already
    // treats "unavailable" as allowed. Only the fail-closed ones benefit
    // from a weaker-but-real limit instead of a hard refusal.
    if (failOpen(bucket)) return "unavailable";
    return checkLocal(bucket, identifier);
  }
}

// Returns true when the request is allowed. On an unexpected Redis error the
// outcome is bucket-dependent — see failOpen().
export async function allow(bucket: RateBucket, identifier: string): Promise<boolean> {
  const decision = await check(bucket, identifier);
  return decision === "unavailable" ? failOpen(bucket) : decision === "allowed";
}

// Best-effort client IP from proxy headers (Vercel/Cloudflare set these).
//
// cf-connecting-ip is only trusted when the request's VERIFIED connecting
// peer is actually one of Cloudflare's own published IP ranges (see
// lib/cloudflareIps.ts for why: this app's custom domain sits behind
// Cloudflare, but Vercel's own <project>.vercel.app domain is always live
// alongside it and is NOT — anyone hitting that directly could set
// cf-connecting-ip to anything, on every request, and defeat every
// IP-keyed bucket below).
//
// "Verified" means the LAST hop of x-forwarded-for, not the first. Vercel's
// edge appends the real connecting IP as the final entry on every request —
// see https://vercel.com/docs/edge-network/headers — so it can't be spoofed
// the way a client-supplied leftmost hop can. x-real-ip is the fallback for
// runtimes that don't set x-forwarded-for at all (e.g. local dev).
function verifiedPeerIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }
  return headers.get("x-real-ip");
}

export function clientIp(headers: Headers): string {
  const peer = verifiedPeerIp(headers);
  const cf = headers.get("cf-connecting-ip");
  if (cf && peer && isCloudflareIp(peer)) return cf.trim();
  return peer ?? "unknown";
}
