import { describe, it, expect, vi } from "vitest";
import { settle, NETWORK_ERROR } from "./settle";

describe("settle", () => {
  it("passes a returned result through untouched", async () => {
    expect(await settle(Promise.resolve({ ok: true as const }))).toEqual({ ok: true });
    expect(await settle(Promise.resolve({ ok: false as const, error: "no" }))).toEqual({ ok: false, error: "no" });
  });

  it("turns a rejected action into an error result instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await settle(Promise.reject(new TypeError("Failed to fetch")) as Promise<{ ok: true }>);
    expect(res).toEqual({ ok: false, error: NETWORK_ERROR });
  });
});
