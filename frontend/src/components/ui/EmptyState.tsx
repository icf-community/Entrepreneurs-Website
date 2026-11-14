import type { ReactNode } from "react";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";

// ════════════════════════════════════════════════════════════════════
// Foundry · EmptyState (Lumen)
//
// What a list says when it has nothing to list: a glyph in a ring with an orbit
// hairline round it (one small body on the orbit), a title, one line, and an
// action when there is one to take. About twenty pages pasted the same
// rounded card with a sentence in it; this is that card, once.
//
// It takes the existing copy as `children`, so adopting it changes no words:
// `<EmptyState>No opportunities posted yet.</EmptyState>`. Add a `title` when the
// old card had a lead line, and an `action` for its button or link.
//
//   size="compact"  inside a card or a list, where the page is not empty, only this part
//   bare            no surface of its own (inside a Panel, or a band): a Panel must
//                   never hold another panel
//
// The glyph is decorative (aria-hidden): the words carry the meaning. It is a
// server component.
// ════════════════════════════════════════════════════════════════════

export function EmptyState({
  icon = "spark",
  title,
  titleAs: Title = "p",
  action,
  size = "default",
  bare = false,
  className = "",
  children,
}: {
  /** The glyph in the ring. Pick the one that says what is missing (search for "no matches", bookmark for "nothing saved"). */
  icon?: IconName;
  title?: ReactNode;
  /** The element for the title. A plain line by default; pass a heading when the page's outline wants one. */
  titleAs?: "p" | "h2" | "h3" | "h4";
  /** A Button or ButtonLink. */
  action?: ReactNode;
  size?: "default" | "compact";
  bare?: boolean;
  className?: string;
  /** The message: the sentence the old card held. */
  children?: ReactNode;
}) {
  return (
    <div className={`lm-empty ${className}`} data-size={size === "compact" ? "compact" : undefined} data-bare={bare || undefined}>
      <span className="lm-empty__glyph" aria-hidden="true">
        <Icon name={icon} size={size === "compact" ? 20 : 24} />
      </span>
      {title ? <Title className="lm-empty__title">{title}</Title> : null}
      {children ? <div className="lm-empty__text">{children}</div> : null}
      {action ? <div className="lm-empty__action">{action}</div> : null}
    </div>
  );
}
