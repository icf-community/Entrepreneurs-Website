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
  if (!analyticsEnabled) return;
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
