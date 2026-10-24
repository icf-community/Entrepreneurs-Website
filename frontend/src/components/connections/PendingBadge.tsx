"use client";

import { useEffect, useState } from "react";
import { getCachedCount, getCount, listeners } from "@/components/connections/pendingBadgeStore";

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

export function PendingBadge() {
  const [count, setCount] = useState(() => getCachedCount() ?? 0);

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
