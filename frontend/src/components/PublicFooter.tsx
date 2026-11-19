import Link from "next/link";
import type { ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · the signed-out footer (Lumen)
//
// The foot of every page a visitor reaches without the member rail (PublicHeader is its pair at the top): /login, /contact
// (which collects personal data, so it should be one click from the policy that says what happens to it), the four legal
// documents, the 404 and the IdeaForge page. Privacy, Terms and Contact, centred, each a 44 px target: the three links
// /login has always carried, now one component instead of a copy on one page.
//
// `children` is an optional line under the links (the 404 signs off with the name of the product).
//
// A server component that reads no cookies, headers or database: the legal documents and `/` are static routes
// (lib/csp.ts STATIC_CSP_ROUTES), and anything they render has to be too. Three short links fit a 320 px screen on one line,
// so it needs no side margin of its own beyond a hair that stops a wrapped row touching the edge.
// ════════════════════════════════════════════════════════════════════

const FOOT_LINK =
  "inline-flex min-h-[var(--touch)] items-center px-3 text-small text-text-secondary no-underline transition-colors duration-150 hover:text-text-primary";

export function PublicFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="relative z-10 px-4 pb-6">
      <div className="flex flex-wrap justify-center gap-x-4">
        <Link href="/privacy" className={FOOT_LINK}>
          Privacy
        </Link>
        <Link href="/terms" className={FOOT_LINK}>
          Terms
        </Link>
        <Link href="/contact" className={FOOT_LINK}>
          Contact
        </Link>
      </div>
      {children ? <p className="mt-1 text-center text-small text-text-muted">{children}</p> : null}
    </footer>
  );
}
