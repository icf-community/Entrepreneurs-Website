import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";

// ════════════════════════════════════════════════════════════════════
// Foundry · the signed-out header (Lumen)
//
// The bar over every page a visitor reaches without the member rail: /contact for a
// stranger, /pending and /rejected for a member whose account is not open yet. The brand
// at the left, whatever the page offers at the right (a way home, Sign out), a hairline
// under it. It draws no background of its own: the atmosphere shows through, as it does
// everywhere else.
//
// The brand follows the signed-in app: from a tablet up it is the lockup with the product
// name beside it; on a phone it is the roundel alone, 48 px, because the lockup and the
// name are wider than a phone is and the logo may not be shrunk to fit. That is BrandLogo's
// own rule, so the intake and onboarding bars do the same.
//
// It lives under app/login because the partition has no shared folder for a new component;
// the lead may move it to components/ (nothing else imports it from anywhere else).
// ════════════════════════════════════════════════════════════════════

export function PublicHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="relative z-10 border-b border-border-subtle">
      <div className="mx-auto flex max-w-[var(--content-max)] items-center justify-between gap-4 px-[var(--gutter)] py-3 sm:py-4">
        <Link href="/" className="shrink-0 no-underline">
          <BrandLogo size="xs" />
        </Link>
        {children ? <div className="flex items-center gap-3">{children}</div> : null}
      </div>
    </header>
  );
}
