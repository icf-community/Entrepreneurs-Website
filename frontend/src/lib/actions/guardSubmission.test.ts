import { afterEach, describe, it, expect, vi } from "vitest";

// B1: `mode` arrives from the browser (the forms pass it to a "use server"
// action). Only "user" and "admin" are real modes; anything else used to fall
// through both branches and skip Turnstile, the `submit` rate limit and the
// approval check, while the registry still called the member RPC.

type Auth = { isAdmin: boolean; status: string };

function setup(auth: Auth) {
  const verifyTurnstile = vi.fn(async () => false);
  const check = vi.fn(async () => "limited");
  vi.doMock("@/lib/auth/actionAuth", () => ({
    getActionAuth: async () => ({
      user: { id: "u1" },
      isAdmin: auth.isAdmin,
      status: auth.status,
      supabase: {},
      unreachable: false,
    }),
  }));
  vi.doMock("@/lib/turnstile", () => ({ verifyTurnstile }));
  vi.doMock("@/lib/ratelimit", () => ({ check }));
  return { verifyTurnstile, check };
}

async function load() {
  vi.resetModules();
  return import("./guardSubmission");
}

afterEach(() => {
  vi.doUnmock("@/lib/auth/actionAuth");
  vi.doUnmock("@/lib/turnstile");
  vi.doUnmock("@/lib/ratelimit");
});

describe("guardSubmission mode handling", () => {
  it.each(["x", "", "USER", "Admin", undefined, null, 1])(
    "refuses an unknown mode (%s) without reaching the abuse checks' bypass",
    async (mode) => {
      setup({ isAdmin: false, status: "approved" });
      const { guardSubmission } = await load();
      const res = await guardSubmission({ mode: mode as never, noun: "an event" });
      expect(res.ok).toBe(false);
    },
  );

  it("refuses an unknown mode even for a pending member", async () => {
    setup({ isAdmin: false, status: "pending" });
    const { guardSubmission } = await load();
    const res = await guardSubmission({ mode: "x" as never, noun: "an event" });
    expect(res.ok).toBe(false);
  });

  it("still runs Turnstile for user mode", async () => {
    const { verifyTurnstile } = setup({ isAdmin: false, status: "approved" });
    const { guardSubmission } = await load();
    const res = await guardSubmission({ mode: "user", noun: "an event" });
    expect(verifyTurnstile).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
  });

  it("refuses admin mode for a non-admin", async () => {
    setup({ isAdmin: false, status: "approved" });
    const { guardSubmission } = await load();
    const res = await guardSubmission({ mode: "admin", noun: "an event" });
    expect(res).toEqual({ ok: false, error: "Admin access required." });
  });

  it("lets an admin through admin mode without the member abuse checks", async () => {
    const { verifyTurnstile, check } = setup({ isAdmin: true, status: "approved" });
    const { guardSubmission } = await load();
    const res = await guardSubmission({ mode: "admin", noun: "an event" });
    expect(res.ok).toBe(true);
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });
});
