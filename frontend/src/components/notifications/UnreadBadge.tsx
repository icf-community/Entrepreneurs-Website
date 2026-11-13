"use client";

import { useEffect, useState } from "react";
import { getCachedCount, getCount, listeners } from "@/components/notifications/unreadBadgeStore";

// ════════════════════════════════════════════════════════════════════
// Foundry · Unread notifications badge on the rail (launch programme F-x3)
//
// Same design as the Connections PendingBadge, for the same reasons: it
// decorates every authenticated page, so it fails to nothing, is fetched
// from the browser rather than threaded through every page, and is cached
// in module state for a minute so navigating doesn't re-ask. No interval
// polling: it refreshes on navigation after the minute and when the tab
// comes back into view, which is all the freshness a count needs, and at
// 500 members avoids a steady background request stream.
// ════════════════════════════════════════════════════════════════════

export function UnreadBadge() {
  const [count, setCount] = useState(() => getCachedCount() ?? 0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getCount().then(
        (n) => { if (!cancelled) setCount(n); },
        // Decoration: an unapproved member's 42501 or a blip shows nothing.
        () => {},
      );
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    listeners.add(load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      listeners.delete(load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (count <= 0) return null;

  return (
    <span
      className="ml-auto shrink-0 rounded-full border border-accent/40 bg-accent-muted px-1.5 py-0.5 text-caption font-medium leading-none text-accent-light"
      aria-label={`${count} unread ${count === 1 ? "notification" : "notifications"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
