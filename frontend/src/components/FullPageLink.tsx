import Link from "next/link";

// The way from a card in a list to that listing's own page.
//
// It sits in the expanded panel rather than on the card's header because
// the header *is* the expand toggle: an <a> inside that <button> would be
// invalid markup and a keyboard trap. Below the fold of the card, it is
// also where a reader who wants to send this listing to someone else is
// already looking.

export function FullPageLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-lg border border-border-strong bg-transparent px-3 py-2 text-body text-text-secondary no-underline transition-colors hover:border-accent hover:text-text-primary"
    >
      Open full page →
    </Link>
  );
}
