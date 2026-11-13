import Link from "next/link";
import type { ReactNode } from "react";
import { tabClass, tabsClass, type TabsSize, type TabsVariant } from "./tabsClass";

// ════════════════════════════════════════════════════════════════════
// Foundry · LinkTabs (Lumen)
//
// A strip of real links, the URL is the state. A list inside a <nav> named
// by `label`, the current item carries aria-current="page" (never aria-pressed,
// never role="tab": it is navigation, so a screen reader says "link, current
// page"). No JavaScript: it renders on the server, and the caller says which
// item is current because the caller already read the URL.
//
// Internal hrefs go through next/link (prefetch, client navigation); anything
// else stays a plain anchor. The look is the family's (see Tabs.tsx).
// ════════════════════════════════════════════════════════════════════

export type LinkTabItem<T extends string = string> = {
  value: T;
  href: string;
  /** The visible label; a count belongs here so it stays part of the link's name. */
  label: ReactNode;
  title?: string;
};

export function LinkTabs<T extends string>({
  items,
  value,
  label,
  variant = "line",
  size = "md",
  fill = false,
  className = "",
}: {
  items: readonly LinkTabItem<T>[];
  /** The current item's value. */
  value: T;
  /** Names the navigation landmark ("Community views"). */
  label: string;
  variant?: TabsVariant;
  size?: TabsSize;
  fill?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label={label}>
      <ul role="list" className={tabsClass({ variant, size, fill, className })}>
        {items.map((item) => {
          const current = item.value === value ? "page" : undefined;
          const internal = item.href.startsWith("/") && !item.href.startsWith("//");
          return (
            <li key={item.value}>
              {internal ? (
                <Link href={item.href} aria-current={current} title={item.title} className={tabClass}>
                  {item.label}
                </Link>
              ) : (
                <a href={item.href} aria-current={current} title={item.title} className={tabClass}>
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
