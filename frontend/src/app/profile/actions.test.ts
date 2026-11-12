import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const check = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/actionAuth", () => ({ getActionAuth: auth }));
vi.mock("@/lib/ratelimit", () => ({ check }));
vi.mock("@/lib/cache", () => ({ invalidate }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { invalidateDirectoryCache } from "./actions";

// Dropping the cached directory sends every following read to Postgres, so it is for approved members and
// rate limited: a rejected account looping this would keep the cache permanently cold.
beforeEach(() => {
  vi.clearAllMocks();
  check.mockResolvedValue("allowed");
});

describe("invalidateDirectoryCache", () => {
  it.each([
    { label: "signed out", user: null, status: null },
    { label: "pending", user: { id: "u" }, status: "pending_review" },
    { label: "rejected", user: { id: "u" }, status: "rejected" },
  ])("does nothing for a $label account", async ({ user, status }) => {
    auth.mockResolvedValue({ user, isAdmin: false, status });
    await invalidateDirectoryCache();
    expect(invalidate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does nothing once the per-user bucket says limited, and does not count a refused caller", async () => {
    auth.mockResolvedValue({ user: { id: "u" }, isAdmin: false, status: "approved" });
    check.mockResolvedValue("limited");
    await invalidateDirectoryCache();
    expect(check).toHaveBeenCalledWith("directoryRefresh", "u");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("drops the cache for an approved member", async () => {
    auth.mockResolvedValue({ user: { id: "u" }, isAdmin: false, status: "approved" });
    await invalidateDirectoryCache();
    expect(invalidate).toHaveBeenCalledWith("directoryFacets");
    expect(revalidatePath).toHaveBeenCalledWith("/members");
  });

  it("refuses when the bucket is unreachable (fail-closed with directoryRefresh)", async () => {
    auth.mockResolvedValue({ user: { id: "u" }, isAdmin: false, status: "approved" });
    check.mockResolvedValue("unavailable");
    await invalidateDirectoryCache();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("lets an admin through", async () => {
    auth.mockResolvedValue({ user: { id: "a" }, isAdmin: true, status: "pending_review" });
    await invalidateDirectoryCache();
    expect(invalidate).toHaveBeenCalled();
  });
});
