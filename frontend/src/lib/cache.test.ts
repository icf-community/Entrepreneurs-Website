import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The cache module reads its env at import time, so each case re-imports
// with a fresh module registry.
const ENV = { UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" };

const store = new Map<string, unknown>();
const redis = {
  get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
  set: vi.fn(async (k: string, v: unknown, opts?: { nx?: boolean }) => {
    if (opts?.nx && store.has(k)) return null;
    store.set(k, v);
    return "OK";
  }),
  del: vi.fn(async (...ks: string[]) => { ks.forEach((k) => store.delete(k)); return ks.length; }),
  incr: vi.fn(async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, n); return n; }),
  // The one script cache.ts runs: SET KEYS[1] only while KEYS[2] (the
  // generation) still equals ARGV[2].
  eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
    const g = store.get(keys[1]);
    if ((g === undefined && args[1] === "") || String(g) === args[1]) {
      store.set(keys[0], JSON.parse(args[0]));
      return 1;
    }
    return 0;
  }),
  pipeline: vi.fn(() => {
    const ops: (() => Promise<unknown>)[] = [];
    const p = {
      del: (...ks: string[]) => { ops.push(() => redis.del(...ks)); return p; },
      incr: (k: string) => { ops.push(() => redis.incr(k)); return p; },
      exec: async () => { const out = []; for (const op of ops) out.push(await op()); return out; },
    };
    return p;
  }),
};

// A class, not vi.fn(() => redis): the module is constructed with `new`,
// and an arrow function is not a constructor.
vi.mock("@upstash/redis", () => ({ Redis: class { constructor() { return redis; } } }));
vi.mock("server-only", () => ({}));
// after() defers work until the response is sent; run it inline so the
// tests can observe the write.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => { void fn(); } }));

async function load(env: Record<string, string | undefined> = ENV) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("./cache");
}

beforeEach(() => { store.clear(); vi.clearAllMocks(); });
afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_CACHE_REDIS_REST_URL;
  delete process.env.UPSTASH_CACHE_REDIS_REST_TOKEN;
});

describe("cached()", () => {
  it("runs the loader on a miss and serves the stored value on a hit", async () => {
    const { cached } = await load();
    const loader = vi.fn(async () => [{ id: "1" }]);

    expect(await cached("vcs", loader)).toEqual([{ id: "1" }]);
    expect(await cached("vcs", loader)).toEqual([{ id: "1" }]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not store an empty result — that is usually a failed query", async () => {
    const { cached } = await load();
    const loader = vi.fn(async () => [] as unknown[]);

    await cached("vcs", loader, { isCacheable: (v) => v.length > 0 });
    await cached("vcs", loader, { isCacheable: (v) => v.length > 0 });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("skip bypasses both the read and the write, so an admin can't populate a shared key", async () => {
    const { cached } = await load();
    await cached("directoryFacets", async () => "admin-view", { skip: true });
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("falls back to the loader when Redis read fails", async () => {
    const { cached } = await load();
    redis.get.mockRejectedValueOnce(new Error("upstash down"));
    expect(await cached("vcs", async () => "live")).toBe("live");
  });

  it("still returns the value when the Redis write fails", async () => {
    const { cached } = await load();
    redis.eval.mockRejectedValueOnce(new Error("upstash down"));
    expect(await cached("vcs", async () => "live")).toBe("live");
  });

  it("is a pass-through when no Upstash env is configured", async () => {
    const { cached, cacheEnabled } = await load({
      UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined,
    });
    expect(cacheEnabled).toBe(false);
    expect(await cached("vcs", async () => "live")).toBe("live");
    expect(redis.get).not.toHaveBeenCalled();
  });
});

describe("concurrent misses (E1b)", () => {
  // At 250 members a cold or unreachable cache sent every request to the
  // 1.4 s facets query at once. One loader per key per process is enough.
  it("share one loader call and one write", async () => {
    const { cached } = await load();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const loader = vi.fn(async () => { await gate; return { total: 5 }; });
    const calls = Array.from({ length: 20 }, () => cached("directoryFacets", loader));
    release();
    const values = await Promise.all(calls);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(values.every((v) => v.total === 5)).toBe(true);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it("still share one call when Redis is not configured", async () => {
    const { cached } = await load({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
    const loader = vi.fn(async () => ({ total: 1 }));
    await Promise.all([cached("directoryFacets", loader), cached("directoryFacets", loader)]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("run again once the first has settled, and never share an admin's read", async () => {
    const { cached } = await load({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
    const loader = vi.fn(async () => ({ total: 1 }));
    await cached("directoryFacets", loader);
    await cached("directoryFacets", loader);
    await Promise.all([cached("directoryFacets", loader, { skip: true }), cached("directoryFacets", loader, { skip: true })]);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("a failed load reaches every waiter and is not kept", async () => {
    const { cached } = await load({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
    const loader = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue({ total: 2 });
    const both = await Promise.allSettled([cached("directoryFacets", loader), cached("directoryFacets", loader)]);
    expect(both.every((r) => r.status === "rejected")).toBe(true);
    expect(await cached("directoryFacets", loader)).toEqual({ total: 2 });
  });
});

describe("invalidate()", () => {
  it("drops the key so the next read re-runs the loader", async () => {
    const { cached, invalidate } = await load();
    const loader = vi.fn(async () => "v1");

    await cached("vcs", loader);
    await invalidate("vcs");
    await cached("vcs", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("only drops the keys it is given", async () => {
    const { cached, invalidate } = await load();
    const dir = vi.fn(async () => "dir");
    const vcs = vi.fn(async () => "vcs");

    await cached("directoryFacets", dir);
    await cached("vcs", vcs);
    await invalidate("vcs");
    await cached("directoryFacets", dir);
    await cached("vcs", vcs);

    expect(dir).toHaveBeenCalledTimes(1);
    expect(vcs).toHaveBeenCalledTimes(2);
  });

  it("invalidating the directory also drops its cached card lists", async () => {
    // Every directory write path invalidates directoryFacets and nothing
    // else; the first page and the newest members hold the same people,
    // so a profile edit must not leave the old card up for the TTL.
    const { cached, invalidate } = await load();
    const page = vi.fn(async () => ["card"]);
    const newest = vi.fn(async () => ["card"]);
    const vcs = vi.fn(async () => "vcs");

    await cached("directoryFirstPage", page);
    await cached("directoryNewest", newest);
    await cached("vcs", vcs);
    await invalidate("directoryFacets");
    await cached("directoryFirstPage", page);
    await cached("directoryNewest", newest);
    await cached("vcs", vcs);

    expect(page).toHaveBeenCalledTimes(2);
    expect(newest).toHaveBeenCalledTimes(2);
    expect(vcs).toHaveBeenCalledTimes(1);
  });

  it("does not throw when Redis is unreachable — the write has already committed", async () => {
    const { invalidate } = await load();
    redis.del.mockRejectedValueOnce(new Error("upstash down"));
    await expect(invalidate("vcs")).resolves.toBeUndefined();
  });
});

describe("latency guards", () => {
  it("gives up on a slow read and goes to the loader instead", async () => {
    const { cached } = await load();
    // Slower than READ_TIMEOUT_MS (100ms).
    redis.get.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r("stale"), 400)));

    const started = Date.now();
    const value = await cached("vcs", async () => "live");
    const elapsed = Date.now() - started;

    expect(value).toBe("live");
    expect(elapsed, "must not wait out the slow read").toBeLessThan(350);
  });

  it("does not block the response on the cache write", async () => {
    const { cached } = await load();
    let released: () => void = () => {};
    redis.eval.mockImplementationOnce(
      () => new Promise<0 | 1>((resolve) => { released = () => resolve(1); }),
    );

    // Resolves even though the write is still outstanding.
    await expect(cached("vcs", async () => "live")).resolves.toBe("live");
    released();
  });
});

describe("circuit breaker", () => {
  it("stops calling Redis after repeated failures, so the rate limiter keeps its quota", async () => {
    const { cached } = await load();
    redis.get.mockRejectedValue(new Error("quota exceeded"));

    // Three failures trip it.
    for (let i = 0; i < 3; i++) await cached("vcs", async () => "live");
    const callsWhenTripped = redis.get.mock.calls.length;

    // Subsequent reads skip Redis entirely and serve from the loader.
    const loader = vi.fn(async () => "live");
    await cached("vcs", loader);
    await cached("vcs", loader);

    expect(redis.get.mock.calls.length).toBe(callsWhenTripped);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidation still runs while the breaker is open — a stale key matters more", async () => {
    const { cached, invalidate } = await load();
    redis.get.mockRejectedValue(new Error("quota exceeded"));
    for (let i = 0; i < 3; i++) await cached("vcs", async () => "live");

    redis.del.mockClear();
    await invalidate("vcs");
    expect(redis.del).toHaveBeenCalledTimes(1);
  });
});

describe("configuration", () => {
  it("reports when the cache is sharing the rate limiter's database", async () => {
    const shared = await load();
    expect(shared.cacheSharesRateLimitDb).toBe(true);

    const split = await load({
      ...ENV,
      UPSTASH_CACHE_REDIS_REST_URL: "https://cache.upstash.io",
      UPSTASH_CACHE_REDIS_REST_TOKEN: "t2",
    });
    expect(split.cacheSharesRateLimitDb).toBe(false);
  });
});

describe("S0: races between loads and writes", () => {
  // The breaker tests above leave a permanent rejection on get().
  beforeEach(() => { redis.get.mockImplementation(async (k: string) => (store.has(k) ? store.get(k) : null)); });

  it("a load that started before an invalidation does not store the old value", async () => {
    const { cached, invalidate } = await load();
    let finishLoad: (v: string[]) => void = () => {};
    const slowLoad = cached("vcs", () => new Promise<string[]>((resolve) => { finishLoad = resolve; }));
    // While the old read is in flight, a write commits and invalidates.
    await new Promise((r) => setTimeout(r, 20));
    await invalidate("vcs");
    finishLoad(["old"]);
    expect(await slowLoad).toEqual(["old"]);
    await new Promise((r) => setTimeout(r, 0));
    // The next reader must go to the database, not get the stale copy.
    const next = vi.fn(async () => ["new"]);
    expect(await cached("vcs", next)).toEqual(["new"]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("invalidation bumps the key's generation", async () => {
    const { invalidate } = await load();
    await invalidate("vcs");
    await invalidate("vcs");
    expect(store.get("cache:v1:gen:vcs")).toBe(2);
  });

  it("a slow key waits for the instance already loading it instead of querying too", async () => {
    const { cached } = await load();
    // Another instance holds the fill lock and stores its value shortly.
    store.set("cache:v1:lock:directoryFacets", "1");
    setTimeout(() => store.set("cache:v1:directoryFacets", { courses: ["Computing"] }), 150);
    const loader = vi.fn(async () => ({ courses: [] as string[] }));
    expect(await cached("directoryFacets", loader)).toEqual({ courses: ["Computing"] });
    expect(loader).not.toHaveBeenCalled();
  });

  it("a slow key loads anyway when the lock holder never delivers", async () => {
    const { cached } = await load();
    store.set("cache:v1:lock:directoryFacets", "1");
    const loader = vi.fn(async () => ({ courses: ["Physics"] }));
    expect(await cached("directoryFacets", loader)).toEqual({ courses: ["Physics"] });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
