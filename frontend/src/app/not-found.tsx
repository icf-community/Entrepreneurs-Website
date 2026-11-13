import Image from "next/image";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import Starfield from "@/components/Starfield";

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

          <h1 className="font-display text-text-primary leading-[1.15] tracking-tight mb-5 text-display">
            This page doesn&apos;t exist.
          </h1>

          <p className="text-lead text-text-secondary leading-[1.7] mb-10">
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
              className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-tint-2 px-7 py-3.5 text-sm text-text-primary no-underline transition-colors duration-150 hover:border-accent hover:bg-tint-4"
            >
              Join Foundry
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-5">
        <div className="max-w-[1200px] mx-auto flex justify-center">
          <p className="text-small text-text-muted">
            Foundry · Imperial Entrepreneurs
          </p>
        </div>
      </footer>
    </div>
  );
}
