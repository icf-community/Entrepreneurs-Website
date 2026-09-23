"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ErrorBanner } from "@/components/forms/Banners";

// ════════════════════════════════════════════════════════════════════
// Foundry · Segment-scoped error boundary
//
// The root app/error.tsx is a full-screen takeover with no nav — right
// for a genuinely broken app, wrong for one card failing to render in an
// otherwise-fine feed. Next only calls error.tsx for the nearest segment
// boundary, so app/{admin,community,calendar}/error.tsx wrapping this
// keeps the sidebar/nav mounted (they live in the layout above) and
// degrades just the content below it.
// ════════════════════════════════════════════════════════════════════

export function SegmentError({
  error,
  retry,
  label,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** Shown in the message, e.g. "the members admin queue". */
  label: string;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-[560px] space-y-4">
        <ErrorBanner>
          Something went wrong loading {label}. You can try again — the rest
          of the app is unaffected.
        </ErrorBanner>
        <button
          type="button"
          onClick={retry}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-accent px-5 py-2.5 text-sm font-semibold text-bg-primary transition-colors duration-150 hover:bg-accent-dim"
        >
          Try again
        </button>
        {error.digest && (
          <p className="text-[0.7rem] text-text-muted">
            Error ID: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
