import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import Starfield from "@/components/Starfield";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";
import { PublicHeader } from "@/app/login/PublicHeader";

// CSP on this page (history: 2026-09-08 C2 Finding 6; fixed 2026-10-29).
//
// This page is prerendered, so it carries no CSP nonce. Under the strict
// nonce + strict-dynamic policy our own /_next/static bundle would be
// blocked and the starfield would never start. proxy.ts therefore serves
// the nonce-free static policy to GET/HEAD requests whose first path
// segment is not a route the app has (knownRoutes.ts). That list is
// guarded by a test that fails if a top-level folder in src/app is missing
// from it, so a new route cannot silently get the weaker policy.
//
// Do not make this page dynamic to get a nonce: `not-found.tsx` is rendered
// inside every route's tree, so reading a request-scoped API here drags the
// whole app (including "/") back to dynamic. knownRoutes.test.ts asserts
// this file reads no request data.
//
// The look: the sky behind it (no background of its own, so the atmosphere shows through the starfield),
// the brand in the header (the 2026 logo, drawn as vector: the lockup, or the roundel alone on a phone),
// and the number in a lit ring, the one lit thing on the page, with the page's words beside it.
export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <Starfield className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Top bar */}
      <PublicHeader />

      {/* Main */}
      <main id="main-content" tabIndex={-1} className="relative z-10 flex flex-1 items-center justify-center px-[var(--gutter)] py-12">
        <div className="grid w-full max-w-[520px] justify-items-start gap-2">
          <Disc size="lg" lit className="[--_d:104px]">
            <span className="data font-display text-title">404</span>
          </Disc>

          <PageHead
            title="This page doesn't exist."
            lede="The link may be broken, the page may have been moved, or you may have mistyped the address. Let's get you back on track."
            actions={
              <>
                <ButtonLink href="/">
                  Back to home
                  <Icon name="arrow-right" size={16} />
                </ButtonLink>
                <ButtonLink href="/login" variant="ghost">
                  Join Foundry
                </ButtonLink>
              </>
            }
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-[var(--gutter)] py-5">
        <p className="text-center text-small text-text-muted">
          Foundry · Imperial Entrepreneurs
        </p>
      </footer>
    </div>
  );
}
