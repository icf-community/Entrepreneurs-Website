import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";

// ════════════════════════════════════════════════════════════════════
// Foundry · the signed-out header (Lumen)
//
// The bar over every page a visitor reaches without the member rail: /contact for a
// stranger, the legal documents and the 404, /pending and /rejected for a member whose account
// is not open yet, and the bars of /onboarding and /intake, which are this one with a right-hand
// control of their own (the member is signed in there but has no rail yet). The brand at the left,
// whatever the page offers at the right (a way home, Sign out, Skip for now), a hairline under
// it. It draws no background of its own: the atmosphere shows through, as it does everywhere else.
//
// The brand follows the signed-in app: from a tablet up it is the lockup with the product
// name beside it; on a phone it is the roundel alone, 48 px, because the lockup and the
// name are wider than a phone is and the logo may not be shrunk to fit. That is BrandLogo's
// own rule, so every bar of the lifecycle does the same: one lockup, one size, one place.
//
// `sticky` is for a bar that stays while a long form scrolls under it (the intake and onboarding
// flows; from a tablet up, as they were): it then needs a surface of its own, a frosted one, or the
// form would show through it.
//
// It lives under app/login because the partition has no shared folder for a new component;
// the lead may move it to components/ (PublicFooter, its pair, is already there).
// ════════════════════════════════════════════════════════════════════

export function PublicHeader({ children, sticky = false }: { children?: ReactNode; sticky?: boolean }) {
  return (
    <header
      className={`border-b border-border-subtle ${sticky ? "z-40 bg-bg-primary/85 backdrop-blur-md sm:sticky sm:top-0" : "relative z-10"}`}
    >
      <div className="mx-auto flex max-w-[var(--content-max)] items-center justify-between gap-4 px-[var(--gutter)] py-3 sm:py-4">
        <Link href="/" className="shrink-0 no-underline">
          <BrandLogo size="xs" />
        </Link>
        {children ? <div className="flex items-center gap-3">{children}</div> : null}
      </div>
    </header>
  );
}
