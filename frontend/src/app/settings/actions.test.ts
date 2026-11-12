import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/actionAuth", () => ({ getActionAuth: auth }));
vi.mock("@/lib/ratelimit", () => ({ check: vi.fn() }));
vi.mock("@/lib/cache", () => ({ invalidate }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { deleteMyAccount } from "./actions";

// A deleted member's directory card must go with the account, not at the end of its cache TTL; and a
// refused deletion (the last administrator) must not drop the cache for nothing.
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ supabase: { rpc }, user: { id: "u" }, unreachable: false });
});

describe("deleteMyAccount", () => {
  it("deletes the account, then drops the cached directory", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await deleteMyAccount()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("delete_my_account");
    expect(invalidate).toHaveBeenCalledWith("directoryFacets");
  });

  it("passes the database's reason through and invalidates nothing when refused", async () => {
    rpc.mockResolvedValue({ error: { message: "You are the only administrator." } });
    expect(await deleteMyAccount()).toEqual({ ok: false, error: "You are the only administrator." });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out caller", async () => {
    auth.mockResolvedValue({ supabase: { rpc }, user: null, unreachable: false });
    expect((await deleteMyAccount()).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
