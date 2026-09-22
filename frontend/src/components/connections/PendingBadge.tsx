"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

// ════════════════════════════════════════════════════════════════════
// Foundry · The pending-requests badge on the Connections nav row
//
// This is the highest-frequency query in the feature: it decorates a rail
// that renders on every authenticated page. Three decisions follow from
// that, and none of them is arbitrary.
//
// 1. IT FAILS TO NOTHING. A badge is decoration on the app shell. If the
//    count errors, times out, or the member is not approved, the row
//    renders exactly as it did before this existed. It must never be able
//    to take down a page it appears on.
//
// 2. IT IS FETCHED FROM THE BROWSER, NOT PASSED DOWN. AppShell is
//    rendered by ~15 pages; threading a count through all of them would
//    make every one of those pages wait on this query before it could
//    stream, to decorate a nav row. The RPC is a single index-only scan
//    on the partial pending index — sub-millisecond at 250k edges (C3
//    benchmark, 0.43ms) — so the round trip is the only real cost.
//
// 3. IT IS CACHED IN MODULE STATE FOR A MINUTE, NOT IN REDIS. Each page
//    renders its own AppShell, so without this, every navigation is
//    another request. A module-level cache lives as long as the tab and
//    costs nothing. Redis is explicitly the wrong place: a cache round
//    trip costs more than the scan, and it would spend the shared
//    500K/month Upstash budget on every page view.
// ════════════════════════════════════════════════════════════════════

const TTL_MS = 60_000;

let cached: { count: number; at: number } | null = null;
let inFlight: Promise<number> | null = null;

async function fetchCount(): Promise<number> {
  const { data, error } = await browserClient().rpc("my_pending_connection_count");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

function getCount(): Promise<number> {
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
const listeners = new Set<() => void>();

/** Call after any action that changes the count, so the badge is not a minute stale. */
export function invalidatePendingBadge() {
  cached = null;
  for (const notify of listeners) notify();
}

export function PendingBadge() {
  const [count, setCount] = useState(cached?.count ?? 0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getCount().then(
        (n) => { if (!cancelled) setCount(n); },
        // Swallowed on purpose. An unapproved member gets a 42501 here and
        // that is correct behaviour, not an incident; anything else is a
        // transient the next navigation retries.
        () => {},
      );
    };
    load();
    listeners.add(load);
    return () => { cancelled = true; listeners.delete(load); };
  }, []);

  if (count <= 0) return null;

  return (
    <span
      className="ml-auto shrink-0 rounded-full border border-accent/40 bg-accent-muted px-1.5 py-0.5 text-[0.65rem] font-medium leading-none text-accent-light"
      // The number alone reads as "3" to a screen reader, which says
      // nothing. The row's own label supplies the noun.
      aria-label={`${count} pending connection ${count === 1 ? "request" : "requests"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
