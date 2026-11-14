"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ErrorBanner } from "@/components/forms/Banners";
import { Button } from "@/components/ui/Button";

// ════════════════════════════════════════════════════════════════════
// Foundry · Segment-scoped error boundary
//
// The root app/error.tsx is a full-screen takeover with no nav — right
// for a genuinely broken app, wrong for one card failing to render in an
// otherwise-fine feed. Next only calls error.tsx for the nearest segment
// boundary. Admin has a real layout above its boundary; member pages
// render AppShell inside page.tsx, so their boundaries use ShellError,
// which wraps this in AppShell to keep the navigation (B9).
//
// Drawn as a danger Notice (the announced message), the one primary action
// below it, and the error id as a measured value. SegmentErrorView is the
// drawing without the reporting, so the style guide can show it at rest.
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

  return <SegmentErrorView label={label} digest={error.digest} retry={retry} />;
}

export function SegmentErrorView({ label, digest, retry }: { label: string; digest?: string; retry: () => void }) {
  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mx-auto grid max-w-[560px] gap-4">
        <ErrorBanner>
          Something went wrong loading {label}. You can try again — the rest
          of the app is unaffected.
        </ErrorBanner>
        <div>
          <Button type="button" size="md" onClick={retry}>
            Try again
          </Button>
        </div>
        {digest && (
          <p className="text-caption text-text-muted">
            Error ID: <span className="data">{digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
