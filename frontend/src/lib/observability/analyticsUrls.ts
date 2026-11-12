// F19 (AI-plan §13): page URLs reach PostHog with the member's id, so the
// AI page's conversation and job ids must not travel with them. Only the
// mode survives; criteria never appear in a URL in the first place.

const URL_PROPS = ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer", "$pathname"];

export function sanitiseAnalyticsUrl(value: string): string {
  try {
    const base = value.startsWith("/") ? "https://x.invalid" : undefined;
    const url = new URL(value, base);
    if (!url.pathname.startsWith("/foundry-ai")) return value;
    const mode = url.searchParams.get("mode");
    url.search = mode ? `?mode=${encodeURIComponent(mode)}` : "";
    url.hash = "";
    return base ? `${url.pathname}${url.search}` : url.toString();
  } catch {
    return value;
  }
}

/** posthog-js before_send: rewrite URL properties, keep everything else. */
export function sanitiseAnalyticsEvent<T extends { properties?: Record<string, unknown> } | null>(event: T): T {
  if (!event?.properties) return event;
  for (const key of URL_PROPS) {
    const v = event.properties[key];
    if (typeof v === "string") event.properties[key] = sanitiseAnalyticsUrl(v);
  }
  return event;
}
