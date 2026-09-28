import { afterEach, describe, it, expect, vi } from "vitest";

// B23: a staged listing edit emails the admins, so edits have their own
// fail-closed bucket. Nothing may reach the update RPC when it refuses.

function setup(decision: "allowed" | "limited" | "unavailable") {
  const update = vi.fn(async () => ({ ok: true }));
  vi.doMock("@/lib/auth/actionAuth", () => ({
    getActionAuth: async () => ({ user: { id: "u1" }, supabase: { rpc: async () => ({ data: null }) }, unreachable: false }),
  }));
  vi.doMock("@/lib/ratelimit", () => ({ check: vi.fn(async () => decision) }));
  vi.doMock("./registry", async (orig) => {
    const real = await orig<typeof import("./registry")>();
    return { ...real, LISTINGS: { ...real.LISTINGS, event: { ...real.LISTINGS.event, update } } };
  });
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/lib/cache", () => ({ invalidate: vi.fn() }));
  return { update };
}

afterEach(() => {
  for (const m of ["@/lib/auth/actionAuth", "@/lib/ratelimit", "./registry", "next/cache", "@/lib/cache"]) vi.doUnmock(m);
});

describe("updateOwnListing rate limit", () => {
  it.each(["limited", "unavailable"] as const)("refuses without writing when the bucket says %s", async (d) => {
    const { update } = setup(d);
    vi.resetModules();
    const { updateOwnListing } = await import("./user");
    const res = await updateOwnListing("event", "e1", {});
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes when allowed", async () => {
    const { update } = setup("allowed");
    vi.resetModules();
    const { updateOwnListing } = await import("./user");
    await updateOwnListing("event", "e1", {});
    expect(update).toHaveBeenCalledOnce();
  });
});
