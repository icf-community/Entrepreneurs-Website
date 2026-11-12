import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { startPoll } from "./poll";

// B8/B20 (old S3): the CV/GitHub progress polls ran on fixed setInterval
// timers, so a slow response overlapped the next request (500 open dialogs
// ≈ 250 req/s) and a thrown request left the spinner running forever.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startPoll", () => {
  it("never starts a request while the previous one is still running", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    startPoll({
      fetch: async () => {
        calls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5_000)); // slower than any interval
        inFlight--;
        return calls;
      },
      onResult: () => (calls >= 3 ? "stop" : "continue"),
      onError: () => {},
      baseMs: 1_000,
      random: () => 0.5,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(maxInFlight).toBe(1);
    expect(calls).toBe(3);
  });

  it("backs off between polls up to the cap", async () => {
    const at: number[] = [];
    startPoll({
      fetch: async () => { at.push(Date.now()); return null; },
      onResult: () => (at.length >= 6 ? "stop" : "continue"),
      onError: () => {},
      baseMs: 1_000,
      maxMs: 4_000,
      random: () => 0.5, // no jitter
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(gaps).toEqual([1_000, 2_000, 4_000, 4_000, 4_000]);
  });

  it("stops and reports when a request throws, instead of spinning forever", async () => {
    const onError = vi.fn();
    const fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    startPoll({ fetch, onResult: () => "continue", onError, baseMs: 1_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onError).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("stop() cancels the next request", async () => {
    const fetch = vi.fn(async () => null);
    const stop = startPoll({ fetch, onResult: () => "continue", onError: () => {}, baseMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
