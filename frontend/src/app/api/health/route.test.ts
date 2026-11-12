import { afterEach, describe, it, expect, vi } from "vitest";

// This is what an external uptime monitor polls. Its entire reason to
// exist over a static 200 is catching a paused/suspended free-tier
// Supabase project, which looks identical to "the site is up" unless the
// route actually touches the database — so what's worth pinning is that a
// DB error (or the client throwing outright) surfaces as a 503, not a
// false-positive 200.
async function load() {
  vi.resetModules();
  return import("./route");
}

function stubDb(result: { error: { message: string } | null } | (() => never)) {
  vi.doMock("@/lib/supabase/service", () => ({
    createServiceClient: () => ({
      from: () => ({
        select: () => ({
          limit: typeof result === "function" ? result : async () => result,
        }),
      }),
    }),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("reports ok when the DB answers", async () => {
    stubDb({ error: null });
    const { GET } = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("503s when the query returns an error, instead of a false-positive 200", async () => {
    stubDb({ error: { message: "relation does not exist" } });
    const { GET } = await load();
    const res = await GET();
    expect(res.status).toBe(503);
    // B3: anonymous callers get no DB error text (schema names, hosts).
    expect(await res.json()).toEqual({ ok: false });
  });

  it("503s rather than 500ing when the client throws (e.g. a paused project)", async () => {
    stubDb(() => {
      throw new Error("fetch failed");
    });
    const { GET } = await load();
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
