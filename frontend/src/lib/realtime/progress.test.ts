import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// A fake browser client, for the tests that go through the real channel
// registry (subscribeToProgress) instead of an injected subscribe.
const fake = vi.hoisted(() => {
  type Cb = (status: string) => void;
  const state = {
    joins: 0,
    removed: 0,
    statusCb: null as Cb | null,
    broadcast: null as ((m: { payload: unknown }) => void) | null,
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    channel: () => {
      const ch = {
        on: (_t: string, _f: unknown, cb: (m: { payload: unknown }) => void) => { state.broadcast = cb; return ch; },
        subscribe: (cb: Cb) => { state.joins += 1; state.statusCb = cb; return ch; },
      };
      return ch;
    },
    removeChannel: async () => { state.removed += 1; return "ok"; },
  };
  return { state, client };
});
vi.mock("@/lib/supabase/browser", () => ({ browserClient: () => fake.client }));

import { watchProgress, subscribeToProgress, SAFETY_CHECK_MS, MAX_LIVE_MS } from "./progress";

// The progress views used to poll every 1–8 s. They now wait for a signal
// and re-read once per signal, with a slow safety check, and fall back to
// the old poller only if the channel can't join. Realtime is metered, so
// the socket rules (lazy, released when hidden, capped, no join loops) are
// tested as hard as the request counts.

type Listener = { onSignal: (s: { kind?: string; turn?: string }) => void; onUp: () => void; onDown: () => void };

function fakeChannel() {
  const ch = { l: null as Listener | null, subscribed: 0, released: 0 };
  const subscribe = (l: Listener) => {
    ch.l = l;
    ch.subscribed += 1;
    return () => { ch.released += 1; };
  };
  return { ch, subscribe };
}

/** A minimal document with controllable visibility. */
function fakeDocument(initial: "visible" | "hidden" = "visible") {
  const target = new EventTarget();
  const doc = Object.assign(target, { visibilityState: initial });
  vi.stubGlobal("document", doc);
  return {
    set(state: "visible" | "hidden") {
      doc.visibilityState = state;
      target.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

const live = { onResult: () => "continue" as const, onError: () => {} };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("watchProgress — requests", () => {
  it("reads on start, on join and per matching signal — and not on a timer", async () => {
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    watchProgress({ kind: "cv", subscribe, fetch: async () => ++calls, ...live });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    ch.l!.onUp();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);

    // The old poller would have made ~5 requests in 20 s; this makes none.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toBe(2);

    ch.l!.onSignal({ kind: "github" }); // another kind: ignored
    ch.l!.onSignal({ kind: "cv" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(3);
  });

  it("still re-checks on the safety interval, so a dropped signal can't strand the view", async () => {
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    watchProgress({ kind: "cv", subscribe, fetch: async () => ++calls, ...live });
    await vi.advanceTimersByTimeAsync(0);
    ch.l!.onUp();
    await vi.advanceTimersByTimeAsync(0);
    const before = calls;
    await vi.advanceTimersByTimeAsync(SAFETY_CHECK_MS);
    expect(calls).toBe(before + 1);
  });

  it("filters AI turn signals by turn id", async () => {
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    watchProgress({ kind: "ai_turn", turnId: "t1", subscribe, fetch: async () => ++calls, ...live });
    await vi.advanceTimersByTimeAsync(0);
    ch.l!.onSignal({ kind: "ai_turn", turn: "t2" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    ch.l!.onSignal({ kind: "ai_turn", turn: "t1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
  });

  it("coalesces signals that arrive mid-request into one follow-up read", async () => {
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    watchProgress({
      kind: "cv", subscribe,
      fetch: async () => {
        calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1_000));
        inFlight--;
        return calls;
      },
      ...live,
    });
    await vi.advanceTimersByTimeAsync(1_000); // first read done → subscribed
    ch.l!.onSignal({ kind: "cv" });
    ch.l!.onSignal({ kind: "cv" });
    ch.l!.onSignal({ kind: "cv" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(maxInFlight).toBe(1);
    expect(calls).toBe(3); // the first read, one for the burst, one coalesced follow-up
  });

  it("a thrown read stops everything and reports once", async () => {
    const { subscribe } = fakeChannel();
    const onError = vi.fn();
    watchProgress({ kind: "cv", subscribe, fetch: async () => { throw new Error("boom"); }, onResult: () => "continue", onError });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("falls back to the backoff poller when the channel can't join", async () => {
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    watchProgress({ kind: "cv", subscribe, fetch: async () => ++calls, ...live, baseMs: 1_000, maxMs: 1_000, random: () => 0.5 });
    await vi.advanceTimersByTimeAsync(0);
    ch.l!.onDown();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBeGreaterThanOrEqual(5);
  });

  it("the caller's stop() releases the channel and ends the fallback poller", async () => {
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    const stop = watchProgress({ kind: "cv", subscribe, fetch: async () => ++calls, ...live, baseMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    ch.l!.onDown();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const at = calls;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(at);
  });
});

describe("watchProgress — socket cost", () => {
  it("opens no socket when the first read says the work is already done", async () => {
    const { ch, subscribe } = fakeChannel();
    watchProgress({ kind: "cv", subscribe, fetch: async () => "ready", onResult: () => "stop", onError: () => {} });
    await vi.advanceTimersByTimeAsync(SAFETY_CHECK_MS * 2);
    expect(ch.subscribed).toBe(0);
  });

  it("releases the socket when the work finishes", async () => {
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    watchProgress({ kind: "cv", subscribe, fetch: async () => ++calls, onResult: (n) => (n >= 2 ? "stop" : "continue"), onError: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(ch.subscribed).toBe(1);
    ch.l!.onSignal({ kind: "cv" });
    await vi.advanceTimersByTimeAsync(0);
    expect(ch.released).toBe(1);
    ch.l!.onSignal({ kind: "cv" });
    await vi.advanceTimersByTimeAsync(SAFETY_CHECK_MS * 3);
    expect(calls).toBe(2);
  });

  it("releases the socket while the tab is hidden, and rejoins with a fresh read on return", async () => {
    const page = fakeDocument("visible");
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    watchProgress({ kind: "cv", subscribe, fetch: async () => ++calls, ...live });
    await vi.advanceTimersByTimeAsync(0);
    expect(ch.subscribed).toBe(1);

    page.set("hidden");
    expect(ch.released).toBe(1);
    await vi.advanceTimersByTimeAsync(SAFETY_CHECK_MS * 10); // nothing while hidden
    expect(calls).toBe(1);

    page.set("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(ch.subscribed).toBe(2);
  });

  it("holds the socket for at most MAX_LIVE_MS, then only safety checks", async () => {
    const { ch, subscribe } = fakeChannel();
    let calls = 0;
    watchProgress({ kind: "cv", subscribe, fetch: async () => ++calls, ...live });
    await vi.advanceTimersByTimeAsync(0);
    expect(ch.subscribed).toBe(1);
    await vi.advanceTimersByTimeAsync(MAX_LIVE_MS);
    expect(ch.released).toBe(1);
    const at = calls;
    await vi.advanceTimersByTimeAsync(SAFETY_CHECK_MS * 2);
    expect(calls - at).toBeLessThanOrEqual(2);
    expect(calls - at).toBeGreaterThanOrEqual(1);
    expect(ch.subscribed).toBe(1); // never re-opened
  });
});

describe("subscribeToProgress — one channel, no join loops", () => {
  it("shares one channel between waiters and drops it when the last leaves", async () => {
    fake.state.joins = 0; fake.state.removed = 0;
    const l = () => ({ onSignal: vi.fn(), onUp: vi.fn(), onDown: vi.fn() });
    const a = l(), b = l();
    const ra = subscribeToProgress(a);
    const rb = subscribeToProgress(b);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.joins).toBe(1);
    fake.state.statusCb!("SUBSCRIBED");
    fake.state.broadcast!({ payload: { kind: "cv" } });
    expect(a.onSignal).toHaveBeenCalledWith({ kind: "cv" });
    expect(b.onSignal).toHaveBeenCalledWith({ kind: "cv" });
    ra();
    expect(fake.state.removed).toBe(0);
    rb();
    expect(fake.state.removed).toBe(1);
  });

  it("a failed join removes the channel (no realtime-js rejoin loop) and tells every waiter", async () => {
    fake.state.joins = 0; fake.state.removed = 0;
    const a = { onSignal: vi.fn(), onUp: vi.fn(), onDown: vi.fn() };
    const release = subscribeToProgress(a);
    await vi.advanceTimersByTimeAsync(0);
    fake.state.statusCb!("CHANNEL_ERROR");
    expect(fake.state.removed).toBe(1);
    expect(a.onDown).toHaveBeenCalledTimes(1);
    release(); // no double removal
    expect(fake.state.removed).toBe(1);

    // The next wait tries once more, on a fresh channel.
    const r2 = subscribeToProgress({ onSignal: vi.fn(), onUp: vi.fn(), onDown: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.joins).toBe(2);
    r2();
  });
});
