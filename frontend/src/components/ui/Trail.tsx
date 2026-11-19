import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/design-system/icons/Icon";

// ═════════════════════════════════════════════════════════════════
// Foundry · Trail (Lumen)
//
// Where a page sits, and the way back: the PageHead's `context` for any page that
// has a parent. A link to the parent (a drawn left arrow, then its name) and, if the
// page has its own name, a chevron and that name. Every page with a parent uses it,
// so the arrow, the spacing and the separator are the same everywhere.
//
//   <PageHead context={<Trail href="/settings" label="Settings" current="Your profile" />} … />
//
// The arrow is drawn; its character stays as visually hidden text, so the link's
// accessible name is still "← Settings" (urlfilters.spec depends on it).
// ═════════════════════════════════════════════════════════════════

export function Trail({ href, label, current }: { href: string; label: string; current?: ReactNode }) {
  return (
    <>
      <Link href={href}>
        <Icon name="arrow-left" size={16} />
        <span className="sr-only">← </span>
        {label}
      </Link>
      {current ? (
        <>
          <Icon name="chevron-right" size={14} />
          {current}
        </>
      ) : null}
    </>
  );
}
