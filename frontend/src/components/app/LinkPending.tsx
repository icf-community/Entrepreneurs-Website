"use client";

import { useLinkStatus } from "next/link";

// ════════════════════════════════════════════════════════════════════
// Foundry · Navigation feedback (launch programme C2)
//
// Rendered inside a <Link>. While that link's navigation is in flight it
// shows a thin bar across the top of the viewport and a dot beside the
// link, so a click on a slow network visibly did something. Both fade in
// after 120 ms (globals.css .nav-pending), so fast navigations never
// flash. Decorative only: the page announces itself when it arrives.
// ════════════════════════════════════════════════════════════════════
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <span aria-hidden className="nav-pending nav-pending-bar" />
      <span aria-hidden className="nav-pending ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
    </>
  );
}
