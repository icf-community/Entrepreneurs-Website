import { afterEach, describe, it, expect, vi } from "vitest";
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

// S2: server actions return a Result instead of throwing, so an outage
// must come back as "couldn't reach the server" — never as "You must be
// signed in", which blames the member for Foundry being down.

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

type Res = { data: unknown; error: unknown; status?: number };

function setup(opts: { user: unknown; authError?: unknown; isAdmin?: Res; profile?: Res }) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => opts.profile ?? { data: { status: "approved" }, error: null, status: 200 },
  };
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: opts.user }, error: opts.authError ?? null }) },
      rpc: async () => opts.isAdmin ?? { data: true, error: null, status: 200 },
      from: () => q,
    }),
  }));
}

async function load() {
  vi.resetModules();
  return import("./actionAuth");
}

afterEach(() => vi.doUnmock("@/lib/supabase/server"));

describe("getActionAuth / requireAdmin", () => {
  it("an Auth outage is `unreachable`, and requireAdmin says so", async () => {
    setup({ user: null, authError: new AuthRetryableFetchError("fetch failed", 0) });
    const m = await load();
    expect(await m.getActionAuth()).toMatchObject({ user: null, unreachable: true });
    expect(await m.requireAdmin()).toEqual({ ok: false, error: (await import("@/lib/supabase/unavailable")).UNREACHABLE_MESSAGE });
  });

  it("a failed is_admin is `unreachable`, not a demotion to member", async () => {
    setup({ user: { id: "u1" }, isAdmin: { data: null, error: { message: "x" }, status: 503 } });
    const m = await load();
    expect(await m.getActionAuth()).toMatchObject({ unreachable: true, isAdmin: false, user: null });
  });

  it("a failed profile read is `unreachable`, not 'not approved'", async () => {
    setup({ user: { id: "u1" }, profile: { data: null, error: { message: "x" }, status: 0 } });
    const m = await load();
    expect(await m.getActionAuth()).toMatchObject({ unreachable: true });
  });

  it("a genuinely signed-out caller is still told to sign in", async () => {
    setup({ user: null, authError: new AuthSessionMissingError() });
    const m = await load();
    expect(await m.getActionAuth()).toMatchObject({ user: null, unreachable: false });
    expect(await m.requireAdmin()).toEqual({ ok: false, error: "You must be signed in." });
  });

  it("an approved admin passes", async () => {
    setup({ user: { id: "u1" } });
    const m = await load();
    expect(await m.requireAdmin()).toMatchObject({ ok: true });
  });
});

describe("unreachableAsNull", () => {
  it("turns ServiceUnavailableError into null and rethrows anything else", async () => {
    setup({ user: null });
    const m = await load();
    const { ServiceUnavailableError } = await import("@/lib/supabase/unavailable");
    expect(m.unreachableAsNull(new ServiceUnavailableError("x"))).toBeNull();
    expect(() => m.unreachableAsNull(new Error("real bug"))).toThrow("real bug");
  });
});
