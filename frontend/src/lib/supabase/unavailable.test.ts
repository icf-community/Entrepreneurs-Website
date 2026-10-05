import { describe, it, expect, vi, afterEach } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import { fetchWithTimeout } from "./unavailable";

// D3 outage drill: with PostgREST paused, /profile hung past 60 s. Our
// timeout fired, but AbortSignal.timeout() rejects with a TimeoutError,
// and postgrest-js retries a GET on any fetch error except an AbortError
// (3 more attempts, 1/2/4 s apart) — so every timed-out select waited four
// timeouts plus the backoff before the page could show its error.

/** A server that accepts the connection and never answers. */
function stalledFetch() {
  return vi.fn((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchWithTimeout", () => {
  it("rejects a stalled request as an AbortError", async () => {
    vi.stubGlobal("fetch", stalledFetch());
    await expect(fetchWithTimeout(20)("http://x.invalid")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("lets a timed-out PostgREST GET fail once, as unreachable, without retries", async () => {
    const stalled = stalledFetch();
    vi.stubGlobal("fetch", stalled);
    const db = new PostgrestClient("http://x.invalid/rest/v1", { fetch: fetchWithTimeout(20) });
    const t0 = Date.now();
    const res = await db.from("profiles").select("id");
    expect(res.status).toBe(0);
    expect(res.error).not.toBeNull();
    expect(stalled).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
