import { browserClient } from "@/lib/supabase/browser";

// See UnreadBadge.tsx for why this cache exists and why it is module state.

const TTL_MS = 60_000;

let cached: { count: number; at: number } | null = null;
let inFlight: Promise<number> | null = null;

async function fetchCount(): Promise<number> {
  const { data, error } = await browserClient().rpc("my_unread_notification_count");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export function getCachedCount(): number | undefined {
  return cached?.count;
}

export function getCount(force = false): Promise<number> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.count);
  inFlight ??= fetchCount()
    .then((n) => {
      cached = { count: n, at: Date.now() };
      return n;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export const listeners = new Set<() => void>();

/** Call after marking notifications read, so the badge updates at once. */
export function invalidateUnreadBadge() {
  cached = null;
  for (const notify of listeners) notify();
}
