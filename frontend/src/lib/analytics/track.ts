import type { PostHog } from "posthog-js";

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export const analyticsEnabled = Boolean(POSTHOG_KEY);

// posthog-js is imported on demand, after hydration and only when the key
// is set: it was ~90 KB gzipped in every page's first load (D1). Until it
// arrives, track() queues; the queue is flushed once on load.
let ph: PostHog | null = null;
const queued: [string, Record<string, unknown> | undefined][] = [];

// Thin capture wrapper so call sites don't each have to re-check
// analyticsEnabled — a no-op with no PostHog traffic when the key is unset,
// same inert-by-default stance as the rest of this file.
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!analyticsEnabled || analyticsOptedOut()) return;
  if (ph) ph.capture(event, properties);
  else queued.push([event, properties]);
}

// Called by PostHogProvider once it has identified the member — track()
// goes straight to PostHog only from here on, so queued events are
// attributed to the member.
export function flushQueuedTracking(instance: PostHog): void {
  if (ph) return;
  ph = instance;
  for (const [name, properties] of queued.splice(0)) instance.capture(name, properties);
}

// Per-device analytics opt-out (Settings → Analytics). Honours a member's
// Art 21 objection to the legitimate-interests analytics in Privacy §3.
// Stored in localStorage because PostHog itself keeps nothing on the device
// (persistence: "memory"); a read that throws counts as "not opted out",
// since that is the state the page renders without storage.
const OPT_OUT_KEY = "foundry-analytics-off";
export const ANALYTICS_CHANGE_EVENT = "foundry-analytics-change";
// This page's own choice, so it holds even when storage is blocked.
let choiceThisPage: boolean | null = null;

export function analyticsOptedOut(): boolean {
  if (choiceThisPage !== null) return choiceThisPage;
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAnalyticsOptOut(off: boolean): void {
  choiceThisPage = off;
  try {
    if (off) window.localStorage.setItem(OPT_OUT_KEY, "1");
    else window.localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
  if (off) queued.length = 0;
  window.dispatchEvent(new Event(ANALYTICS_CHANGE_EVENT));
}
