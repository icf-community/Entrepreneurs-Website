import type { ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Icon } from "@/design-system/icons/Icon";
import { externalHref } from "@/lib/safeUrl";

// The links a listing card, and a listing's own page, send a reader along.
//
// FullPageLink is the way from a card in a list to that listing's own page.
// It sits in the expanded panel rather than on the card's header because
// the header *is* the expand toggle: an <a> inside that <button> would be
// invalid markup and a keyboard trap. Below the fold of the card, it is
// also where a reader who wants to send this listing to someone else is
// already looking.
//
// The arrows are drawn (Icons); the characters stay as visually hidden text so a
// link's accessible name is still "Open full page →", "RSVP on Luma ↗" (urlfilters.spec
// pins the first; the others are what a screen reader has always heard).

export function FullPageLink({ href }: { href: string }) {
  return (
    <ButtonLink href={href} variant="ghost" size="sm">
      Open full page<span className="sr-only"> →</span>
      <Icon name="arrow-right" size={16} />
    </ButtonLink>
  );
}

/** The arrow after a link that leaves Foundry ("LinkedIn ↗"): drawn, with the character kept as hidden text. Decorative in sight, in the name for a reader. */
export function OutArrow() {
  return (
    <>
      <span className="sr-only"> ↗</span>
      <Icon name="arrow-up-right" size={16} />
    </>
  );
}

/**
 * A button-shaped link to a member-supplied URL (RSVP on Luma, Open application portal, Open link).
 *
 * The URL is checked on the way out (safeUrl.ts): anything that is not http(s) fails to nothing, which for an
 * anchor used to mean an inert, href-less link. A ButtonLink needs a real href, so that case is an inert disabled
 * button here: the same non-link, drawn by the system.
 */
export function ExternalButtonLink({
  href, variant = "primary", size = "sm", lit = false, onClick, children,
}: {
  href: string | null | undefined;
  variant?: ButtonVariant;
  size?: ButtonSize;
  lit?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const safe = externalHref(href);
  if (!safe) {
    return (
      <Button type="button" variant={variant} size={size} disabled>
        {children}
        <OutArrow />
      </Button>
    );
  }
  return (
    <ButtonLink href={safe} target="_blank" rel="noreferrer noopener" onClick={onClick} variant={variant} size={size} lit={lit}>
      {children}
      <OutArrow />
    </ButtonLink>
  );
}
