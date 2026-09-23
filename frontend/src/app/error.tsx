"use client";

import Link from "next/link";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Starfield from "@/components/Starfield";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // instrumentation.ts's onRequestError only covers server-render
    // errors — an error caught here (after hydration, in a client
    // component) would otherwise never reach Sentry despite the rest of
    // the app being fully wired to it.
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="relative min-h-screen bg-bg-primary flex flex-col overflow-hidden">
      <Starfield className="pointer-events-none absolute inset-0 h-full w-full" />

      <main id="main-content" tabIndex={-1} className="relative z-10 flex-1 flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-[560px] text-center">
          <div className="font-display text-text-muted text-[clamp(2rem,5vw,3rem)] leading-none mb-4">
            Oops
          </div>

          <h1 className="font-display text-text-primary leading-[1.15] tracking-tight mb-5 text-[clamp(1.75rem,3.5vw,2.5rem)]">
            Something went wrong.
          </h1>

          <p className="text-[0.95rem] text-text-secondary leading-[1.7] mb-10">
            We couldn&apos;t load this page. This is usually a brief hiccup on our side
            and nothing is wrong with your account — try again in a moment.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={retry}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-accent px-7 py-3.5 text-sm font-semibold text-bg-primary transition-colors duration-150 hover:bg-accent-dim"
            >
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-white/[0.05] px-7 py-3.5 text-sm text-text-primary no-underline transition-colors duration-150 hover:border-accent hover:bg-white/[0.10]"
            >
              Back to home
            </Link>
          </div>

          {error.digest && (
            <p className="mt-8 text-[0.7rem] text-text-muted">
              Error ID: <span className="font-mono">{error.digest}</span>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
