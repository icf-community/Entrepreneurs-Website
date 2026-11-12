import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Node test environment: stand up the two browser globals track.ts touches.
function fakeWindow(storageThrows = false) {
  const store = new Map<string, string>();
  const target = new EventTarget();
  const localStorage = {
    getItem: (k: string) => { if (storageThrows) throw new Error("blocked"); return store.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (storageThrows) throw new Error("blocked"); store.set(k, v); },
    removeItem: (k: string) => { if (storageThrows) throw new Error("blocked"); store.delete(k); },
  };
  return {
    store,
    window: {
      localStorage,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    },
  };
}

describe("analytics opt-out", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("persists the choice and announces it", async () => {
    const fake = fakeWindow();
    vi.stubGlobal("window", fake.window);
    const { analyticsOptedOut, setAnalyticsOptOut, ANALYTICS_CHANGE_EVENT } = await import("./track");
    const heard = vi.fn();
    window.addEventListener(ANALYTICS_CHANGE_EVENT, heard);
    expect(analyticsOptedOut()).toBe(false);
    setAnalyticsOptOut(true);
    expect(analyticsOptedOut()).toBe(true);
    expect(fake.store.get("foundry-analytics-off")).toBe("1");
    setAnalyticsOptOut(false);
    expect(analyticsOptedOut()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("reads a choice made on an earlier visit", async () => {
    const fake = fakeWindow();
    fake.store.set("foundry-analytics-off", "1");
    vi.stubGlobal("window", fake.window);
    const { analyticsOptedOut } = await import("./track");
    expect(analyticsOptedOut()).toBe(true);
  });

  it("still holds the choice when storage throws", async () => {
    vi.stubGlobal("window", fakeWindow(true).window);
    const { analyticsOptedOut, setAnalyticsOptOut } = await import("./track");
    setAnalyticsOptOut(true);
    expect(analyticsOptedOut()).toBe(true);
  });
});
