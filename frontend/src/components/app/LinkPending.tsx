"use client";

import { useLinkStatus } from "next/link";

// ════════════════════════════════════════════════════════════════════
// Foundry · Navigation feedback (launch programme C2)
//
// Rendered inside a rail row (<Link className="lm-navitem">). While that
// link's navigation is in flight it shows a thin bar across the top of the
// viewport and turns the row's ring (shell.css), so a click on a slow network
// visibly did something. Both fade in after 120 ms (motion.css .nav-pending),
// so fast navigations never flash. Decorative only: the page announces itself
// when it arrives.
// ════════════════════════════════════════════════════════════════════
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <span aria-hidden className="nav-pending nav-pending-bar" />
      <span aria-hidden className="nav-pending lm-navitem__pending">
        <span className="lm-navitem__ring anim-spinner" />
      </span>
    </>
  );
}
