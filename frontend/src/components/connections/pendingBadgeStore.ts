import { browserClient } from "@/lib/supabase/browser";

// See PendingBadge.tsx for why this cache exists and why it is module
// state rather than Redis.

const TTL_MS = 60_000;

let cached: { count: number; at: number } | null = null;
let inFlight: Promise<number> | null = null;

async function fetchCount(): Promise<number> {
  const { data, error } = await browserClient().rpc("my_pending_connection_count");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export function getCachedCount(): number | undefined {
  return cached?.count;
}

export function getCount(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return Promise.resolve(cached.count);
  // One request even if several mounts ask at once.
  inFlight ??= fetchCount()
    .then((n) => {
      cached = { count: n, at: Date.now() };
      return n;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

// Mounted badges, so invalidation can reach the one on screen. Clearing
// `cached` alone is not enough: the badge fetches in a mount effect, so a
// badge that is already mounted never notices. That is not a theoretical
// gap — /connections is the ONE page where the count changes, and the
// badge sits in the rail beside the tab you are emptying. Accept or
// decline your last request and the tab correctly reads "no requests
// waiting" while the rail still claims 1, until you navigate.
export const listeners = new Set<() => void>();

/** Call after any action that changes the count, so the badge is not a minute stale. */
export function invalidatePendingBadge() {
  cached = null;
  for (const notify of listeners) notify();
}
