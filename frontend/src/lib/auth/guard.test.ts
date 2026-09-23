import { afterEach, describe, it, expect, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

// S2: an outage is not a signed-out visitor. Pinned for both page gates:
// every infrastructure failure THROWS (→ the error page, "Try again"),
// and every genuine signed-out / wrong-status case still REDIRECTS
// exactly as before. The redirect mock throws like the real one does.

class Redirect extends Error {
  constructor(public to: string) { super(`redirect:${to}`); }
}

type Res = { data: unknown; error: unknown; status?: number };
const ok = (data: unknown): Res => ({ data, error: null, status: 200 });
const fail = (status: number, code = ""): Res => ({ data: null, error: { message: "x", code }, status });

function setup(opts: { auth: { user: unknown; error: unknown }; isAdmin?: Res; profile?: Res }) {
  vi.doMock("next/navigation", () => ({
    redirect: (to: string) => { throw new Redirect(to); },
  }));
  vi.doMock("next/headers", () => ({
    headers: async () => new Headers({ "x-pathname": "/members" }),
  }));
  const profileQuery = {
    select: () => profileQuery,
    eq: () => profileQuery,
    single: async () => opts.profile ?? ok({ status: "approved", first_name: "Ann" }),
    maybeSingle: async () => opts.profile ?? ok({ status: "approved", first_name: "Ann" }),
  };
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: opts.auth.user }, error: opts.auth.error }) },
      rpc: async () => opts.isAdmin ?? ok(false),
      from: () => profileQuery,
    }),
  }));
}

async function load() {
  vi.resetModules();
  return import("./guard");
}

const user = { id: "u1" };

afterEach(() => {
  vi.doUnmock("next/navigation");
  vi.doUnmock("next/headers");
  vi.doUnmock("@/lib/supabase/server");
});

describe.each(["requireApprovedUser", "requireSignedInUser"] as const)("%s", (fn) => {
  it("redirects a genuinely signed-out visitor to login, keeping ?next=", async () => {
    setup({ auth: { user: null, error: new AuthSessionMissingError() } });
    const g = await load();
    await expect(g[fn]()).rejects.toMatchObject({ to: "/login?next=%2Fmembers" });
  });

  it("redirects on a rejected token (401) — that IS signed out", async () => {
    setup({ auth: { user: null, error: new AuthApiError("bad jwt", 401, "bad_jwt") } });
    const g = await load();
    await expect(g[fn]()).rejects.toBeInstanceOf(Redirect);
  });

  it.each([
    ["network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["gateway 503", new AuthRetryableFetchError("unavailable", 503)],
    ["Auth 500", new AuthApiError("boom", 500, undefined)],
    ["Auth rate limit 429", new AuthApiError("slow down", 429, "over_request_rate_limit")],
  ])("throws ServiceUnavailableError on %s — never a login redirect", async (_, error) => {
    setup({ auth: { user: null, error } });
    const g = await load();
    await expect(g[fn]()).rejects.toMatchObject({ name: "ServiceUnavailableError" });
  });

  it("throws when the profile read cannot reach the database", async () => {
    setup({ auth: { user, error: null }, profile: fail(0) });
    const g = await load();
    await expect(g[fn]()).rejects.toMatchObject({ name: "ServiceUnavailableError" });
  });

  it("throws when is_admin cannot be answered, rather than treating an admin as a member", async () => {
    setup({ auth: { user, error: null }, isAdmin: fail(503) });
    const g = await load();
    await expect(g[fn]()).rejects.toMatchObject({ name: "ServiceUnavailableError" });
  });
});

describe("requireApprovedUser status routing is unchanged", () => {
  it("still sends a missing profile row (PGRST116) to login", async () => {
    setup({ auth: { user, error: null }, profile: fail(406, "PGRST116") });
    const g = await load();
    await expect(g.requireApprovedUser()).rejects.toMatchObject({ to: "/login?next=%2Fmembers" });
  });

  it("still sends pending_review to /pending", async () => {
    setup({ auth: { user, error: null }, profile: ok({ status: "pending_review", first_name: "Ann" }) });
    const g = await load();
    await expect(g.requireApprovedUser()).rejects.toMatchObject({ to: "/pending" });
  });

  it("lets an approved member through", async () => {
    setup({ auth: { user, error: null } });
    const g = await load();
    await expect(g.requireApprovedUser()).resolves.toMatchObject({ status: "approved", isAdmin: false });
  });
});
