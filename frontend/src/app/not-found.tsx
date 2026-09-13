import Image from "next/image";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import Starfield from "@/components/Starfield";

// KNOWN CAVEAT (2026-09-08, C2 Finding 6) — read before "fixing" this.
//
// This page is prerendered, so it carries no CSP nonce, while the
// middleware stamps every unmatched path with the STRICT nonce +
// strict-dynamic policy (a 404 can be any URL, so it cannot be listed in
// csp.ts's STATIC_CSP_ROUTES). Under strict-dynamic our own
// /_next/static bundle has no nonce and is blocked, so on a 404 the
// markup paints and every link works — they are real anchors — but the
// starfield does not animate and the console shows CSP violations.
//
// Making it dynamic was tried and REVERTED. `not-found.tsx` is a special
// file so `export const dynamic` does not apply; the only lever is
// reading a request-scoped API, and because Next renders the root
// not-found inside every route's tree, doing so drags the entire app
// back to dynamic — including "/", which is the whole point of the
// change and the app's slowest measured route. Trading the homepage's
// static render for an animation on the error page is a bad deal.
//
// The clean fix, if this ever matters: teach proxy.ts a list of known
// route prefixes and serve the nonce-free policy to anything outside it.
// Deliberately not done here — that list is a new thing to keep in sync,
// and the symptom is cosmetic.
export default function NotFound() {
  return (
    <div className="relative min-h-screen bg-bg-primary flex flex-col overflow-hidden">
      <Starfield className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Top bar */}
      <header className="relative z-10 px-8 py-5">
        <div className="max-w-[1200px] mx-auto">
          <Link href="/" className="no-underline w-fit inline-block">
            <BrandLogo size="sm" />
          </Link>
        </div>
      </header>

      {/* Main */}
      <main id="main-content" tabIndex={-1} className="relative z-10 flex-1 flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-[560px] text-center flex flex-col items-center">
          <Image
            src="/logo-full.png"
            alt="Imperial Entrepreneurs — go do shit."
            width={1024}
            height={379}
            priority
            sizes="(min-width: 768px) 340px, 74vw"
            className="mb-10 h-auto w-full max-w-[340px]"
          />

          <div className="data text-text-primary text-[clamp(3.5rem,11vw,7rem)] leading-none mb-5 tracking-[-0.04em]">
            404
          </div>

          <h1 className="font-display text-text-primary leading-[1.15] tracking-tight mb-5 text-[clamp(1.75rem,3.5vw,2.5rem)]">
            This page doesn&apos;t exist.
          </h1>

          <p className="text-[0.95rem] text-text-secondary leading-[1.7] mb-10">
            The link may be broken, the page may have been moved, or you may have
            mistyped the address. Let&apos;s get you back on track.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-7 py-3.5 text-sm font-semibold text-bg-primary no-underline transition-colors duration-150 hover:bg-accent-dim"
            >
              Back to home
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2.5 7H11.5M8 3.5L11.5 7L8 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-white/[0.05] px-7 py-3.5 text-sm text-text-primary no-underline transition-colors duration-150 hover:border-accent hover:bg-white/[0.10]"
            >
              Join Foundry
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-5">
        <div className="max-w-[1200px] mx-auto flex justify-center">
          <p className="text-[0.75rem] text-text-muted">
            Foundry · Imperial Entrepreneurs
          </p>
        </div>
      </footer>
    </div>
  );
}
