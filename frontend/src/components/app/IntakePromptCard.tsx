"use client";

import Link from "next/link";
import { useState } from "react";

// Shown on /home for an approved member who has deferred /intake
// (profile_version < 2, intake_deferred_at already set — see
// lib/auth/status.ts's postApprovalDestination). Dismissing it only
// hides it for this page view; it comes back on the next visit until
// the member actually finishes /intake, since that's the one thing
// that makes it go away for good.
export function IntakePromptCard() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="mb-10 flex items-start justify-between gap-4 rounded-lg border border-signal/40 bg-signal-muted/60 px-5 py-4">
      <div>
        <p className="text-body font-medium text-text-primary">
          A couple of minutes finishes your profile.
        </p>
        <p className="mt-0.5 text-body leading-[1.6] text-text-secondary">
          A photo, your skills, and what you&apos;re looking for — that&apos;s what
          makes you findable in the directory.{" "}
          <Link href="/intake" className="text-text-primary underline underline-offset-2">
            Pick it up
          </Link>
          .
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-tint-2 px-3 py-1.5 text-small text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary"
      >
        Not now
      </button>
    </div>
  );
}
