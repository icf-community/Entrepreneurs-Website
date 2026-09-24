import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { allow, check, clientIp, failOpen, checkLocal, __resetLocalBuckets } from "./ratelimit";
import type { RateBucket } from "./ratelimit";

// ─── The classification table ──────────────────────────────────────────
//
// FAIL_CLOSED in ratelimit.ts is a LIST, not a default: a bucket left off
// it silently fails OPEN, which is the quiet way an abuse limit stops
// existing. This is the guard that comment promises.
//
// It is `Record<RateBucket, …>`, so adding a bucket to the union breaks
// `pnpm typecheck` here until someone writes down which side it is on —
// the decision is forced at compile time, not discovered in production.
// The test below then asserts the shipped behaviour matches this table,
// so the two cannot drift.
const CLASSIFICATION: Record<RateBucket, "open" | "closed"> = {
  mutations: "open",
  anonMutations: "open",
  submit: "closed",
  communityPost: "closed",
  communityUpload: "closed",
  postReport: "closed",
  avatarUpload: "closed",
  cvUpload: "closed",
  githubConnect: "closed",
  githubShowcase: "closed",
  connectionRequest: "closed",
  connectionRespond: "closed",
  otpVerify: "closed",
};

const EVERY_BUCKET = Object.keys(CLASSIFICATION) as RateBucket[];

describe("clientIp", () => {
  // 173.245.48.1 is inside Cloudflare's published 173.245.48.0/20 — see
  // lib/cloudflareIps.ts. Vercel appends the real connecting peer as the
  // LAST x-forwarded-for hop, so this is what "genuinely came through
  // Cloudflare" looks like on the wire.
  it("trusts cf-connecting-ip when the verified peer is a real Cloudflare IP", () => {
    const h = new Headers({
      "cf-connecting-ip": "4.4.4.4",
      "x-forwarded-for": "1.2.3.4, 173.245.48.1",
    });
    expect(clientIp(h)).toBe("4.4.4.4");
  });

  // The exact bypass this closes: Vercel's own <project>.vercel.app domain
  // is never behind Cloudflare, so a request hitting it directly can set
  // cf-connecting-ip to anything. The verified peer there is Vercel's own
  // edge, not a Cloudflare IP — so the header must be ignored.
  it("ignores cf-connecting-ip when the verified peer is not a Cloudflare IP", () => {
    const h = new Headers({
      "cf-connecting-ip": "4.4.4.4",
      "x-forwarded-for": "1.2.3.4, 76.76.21.21",
    });
    expect(clientIp(h)).toBe("76.76.21.21");
  });

  it("uses the LAST hop of x-forwarded-for as the verified peer, not the first", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIp(h)).toBe("5.6.7.8");
  });

  it("trims whitespace around hops", () => {
    const h = new Headers({ "x-forwarded-for": "  9.9.9.9 , 1.1.1.1  " });
    expect(clientIp(h)).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip when there's no x-forwarded-for", () => {
    const h = new Headers({ "x-real-ip": "8.8.8.8" });
    expect(clientIp(h)).toBe("8.8.8.8");
  });

  it("returns 'unknown' when no proxy headers are present", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("allow", () => {
  it("allows everything when rate limiting is disabled (no Upstash env)", async () => {
    // The test env has no UPSTASH_REDIS_REST_* vars, so the limiter is off and
    // allow() must fail open (the documented behaviour).
    expect(await allow("submit", "user-1")).toBe(true);
    expect(await allow("mutations", "1.2.3.4")).toBe(true);
  });
});

describe("failOpen (behaviour when the limiter backend is unreachable)", () => {
  it("fails OPEN for the coarse mutations backstop (availability)", () => {
    expect(failOpen("mutations")).toBe(true);
  });

  it("fails CLOSED for the security-sensitive submit bucket", () => {
    expect(failOpen("submit")).toBe(false);
  });

  it("fails CLOSED for otpVerify — an outage must not become a way to brute-force a code", () => {
    expect(failOpen("otpVerify")).toBe(false);
  });

  it("fails CLOSED for connectionRequest — an outage must not become an email-harvesting window", () => {
    expect(failOpen("connectionRequest")).toBe(false);
  });

  it("fails CLOSED for connectionRespond — the one connections bucket with no DB cap underneath it", () => {
    expect(failOpen("connectionRespond")).toBe(false);
  });

  it.each(EVERY_BUCKET)("classifies %s deliberately, not by omission", (bucket) => {
    expect(failOpen(bucket)).toBe(CLASSIFICATION[bucket] === "open");
  });
});

describe("check", () => {
  it("reports 'allowed' when rate limiting is disabled (no Upstash env)", async () => {
    expect(await check("submit", "user-1")).toBe("allowed");
    expect(await check("mutations", "u:user-1")).toBe("allowed");
  });
});

// The distinction the three-valued decision exists for: an unreachable
// limiter and a member who really is posting too fast produce the same
// refusal on a fail-closed bucket, and must not produce the same message.
// Nothing else in the suite can reach this path, because the test env has no
// Upstash to fail — so it is built here.
describe("check when the limiter backend throws", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@upstash/ratelimit");
    vi.doUnmock("@upstash/redis");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loadWithBrokenRedis() {
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@upstash/redis", () => ({ Redis: class {} }));
    vi.doMock("@upstash/ratelimit", () => ({
      Ratelimit: class {
        static slidingWindow = () => ({});
        limit() {
          return Promise.reject(new Error("ECONNREFUSED"));
        }
      },
    }));
    return import("./ratelimit");
  }

  it("says 'unavailable' rather than 'limited' for a fail-OPEN bucket", async () => {
    // Fail-open callers already treat "unavailable" as allowed, so there
    // is nothing for the in-process fallback to improve here — the value
    // still has to be distinguishable from a real "limited" so an outage
    // never reads as the member's fault.
    const rl = await loadWithBrokenRedis();
    expect(await rl.check("mutations", "u:user-1")).toBe("unavailable");
  });

  it("falls back to the in-process limiter for a fail-CLOSED bucket", async () => {
    // Changed deliberately (B3.5). This used to return "unavailable",
    // which made every fail-closed bucket REFUSE during a Redis blip —
    // including otpVerify, i.e. sign-in. The ceiling still exists, it is
    // just enforced per-instance now.
    const rl = await loadWithBrokenRedis();
    expect(await rl.check("submit", "user-1")).toBe("allowed");
  });

  it("still fails open on the mutation buckets", async () => {
    const rl = await loadWithBrokenRedis();
    expect(await rl.allow("mutations", "u:user-1")).toBe(true);
    expect(await rl.allow("anonMutations", "ip:1.2.3.4")).toBe(true);
  });

  it("still enforces a real ceiling on a fail-closed bucket during an outage", async () => {
    // The security property the FAIL_CLOSED list exists for: an outage
    // must not become an unlimited-submission window.
    const rl = await loadWithBrokenRedis();
    for (let i = 0; i < 10; i += 1) {
      expect(await rl.check("submit", "burst-user")).toBe("allowed");
    }
    expect(await rl.check("submit", "burst-user")).toBe("limited");
    expect(await rl.allow("submit", "burst-user")).toBe(false);
  });

  it("logs the outage — a swallowed error is how this went unnoticed", async () => {
    const rl = await loadWithBrokenRedis();
    await rl.check("submit", "user-1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"submit" bucket is unreachable'),
      expect.any(Error),
    );
  });
});

// ─── In-process fallback (B3.5) ────────────────────────────────────────
// The failure this exists to prevent: a Redis blip during a traffic spike
// made every FAIL_CLOSED bucket refuse — including otpVerify, which is the
// sign-in path. Everyone funnelled through /login got told they were going
// too fast, during the one event where that matters most.
describe("in-process limiter fallback", () => {
  beforeEach(() => __resetLocalBuckets());

  it("allows a normal number of attempts, then limits", () => {
    for (let i = 0; i < 10; i += 1) {
      expect(checkLocal("otpVerify", "a@ic.ac.uk")).toBe("allowed");
    }
    expect(checkLocal("otpVerify", "a@ic.ac.uk")).toBe("limited");
  });

  it("keeps identities independent — one member cannot lock out another", () => {
    for (let i = 0; i < 11; i += 1) checkLocal("otpVerify", "noisy@ic.ac.uk");
    expect(checkLocal("otpVerify", "quiet@ic.ac.uk")).toBe("allowed");
  });

  it("keeps buckets independent", () => {
    for (let i = 0; i < 11; i += 1) checkLocal("postReport", "u1");
    expect(checkLocal("otpVerify", "u1")).toBe("allowed");
  });

  it("still bounds an outage — it is weaker limiting, not no limiting", () => {
    // 5/day on postReport. The whole security argument for the fallback is
    // that the ceiling survives, just per-instance rather than shared.
    for (let i = 0; i < 5; i += 1) expect(checkLocal("postReport", "u2")).toBe("allowed");
    expect(checkLocal("postReport", "u2")).toBe("limited");
  });

  it("never returns 'unavailable' — that is the value that locked members out", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(checkLocal("otpVerify", "x")).not.toBe("unavailable");
    }
  });
});

describe("bucket key namespace", () => {
  // Preview deploys share the limiter's Upstash database with production
  // (the env vars are scoped to both), so the prefix is the only thing
  // keeping their counters apart. Two properties matter and neither is
  // visible by reading a call site: production's keys must be unchanged
  // from what is already live, and no two buckets may collide.
  // Derived from the classification table above so a new bucket cannot be
  // added without also being key-checked here.
  const ALL_BUCKETS = EVERY_BUCKET;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@upstash/ratelimit");
    vi.doUnmock("@upstash/redis");
    vi.resetModules();
  });

  async function prefixesFor(vercelEnv: string | undefined) {
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    if (vercelEnv === undefined) vi.stubEnv("VERCEL_ENV", "");
    else vi.stubEnv("VERCEL_ENV", vercelEnv);

    const seen: string[] = [];
    vi.doMock("@upstash/redis", () => ({ Redis: class {} }));
    vi.doMock("@upstash/ratelimit", () => ({
      Ratelimit: class {
        static slidingWindow = () => ({});
        constructor(opts: { prefix: string }) {
          seen.push(opts.prefix);
        }
        limit() {
          return Promise.resolve({ success: true });
        }
      },
    }));

    const rl = await import("./ratelimit");
    // Buckets are built lazily, so they have to be touched to exist.
    for (const b of ALL_BUCKETS) await rl.check(b, "someone");
    return seen;
  }

  it("leaves production's keys exactly as they were before namespacing", async () => {
    // The whole point of the conditional: adding the namespace must not
    // reset a single live counter. If this fails, a deploy silently hands
    // every member a fresh allowance on every bucket.
    const prefixes = await prefixesFor("production");
    expect(prefixes).toContain("rl:mut");
    expect(prefixes).toContain("rl:otp");
    expect(prefixes.every((p) => !p.includes("production"))).toBe(true);
  });

  it("separates preview from production", async () => {
    const prefixes = await prefixesFor("preview");
    expect(prefixes).toContain("rl:preview:mut");
    expect(prefixes).not.toContain("rl:mut");
  });

  it("gives every bucket a distinct key", async () => {
    const prefixes = await prefixesFor("production");
    expect(prefixes).toHaveLength(ALL_BUCKETS.length);
    expect(new Set(prefixes).size).toBe(ALL_BUCKETS.length);
  });
});
