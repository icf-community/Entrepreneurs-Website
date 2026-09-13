"use client";

import Link from "next/link";
import { externalHref } from "@/lib/safeUrl";

// ════════════════════════════════════════════════════════════════════
// Foundry · "Your changes are with an admin"
//
// Shown in place of the edit form once a change to an *approved* listing
// has been staged as a revision (20260907000005). Three things have to
// be said here and they are all load-bearing:
//
//   1. The published version is still up. Otherwise the obvious reading
//      of "sent for review" is "my event has been taken down", and the
//      organiser panics or re-posts it.
//   2. Editing again replaces this proposal rather than queueing a
//      second one — which is what the database actually does.
//   3. For an event whose time or place moved: update Luma too.
//      Foundry has no attendee list; registration lives entirely on
//      Luma, so nothing done here reaches anyone who already signed up.
//      An organiser assuming otherwise is the failure this whole path
//      can create, so it is stated at the moment they'd assume it.
// ════════════════════════════════════════════════════════════════════

export default function RevisionQueuedNotice({
  noun,
  remindAboutLuma,
  lumaLink,
}: {
  /** "event", "opportunity", "listing" — completes "your <noun>". */
  noun: string;
  remindAboutLuma?: boolean;
  lumaLink?: string;
}) {
  return (
    <div className="rounded-2xl bg-bg-card border border-border p-8 space-y-4">
      <h2 className="font-display text-[1.4rem] leading-tight text-text-primary">
        Your changes are with an admin
      </h2>
      <p className="text-[0.85rem] text-text-secondary leading-relaxed">
        Your {noun} is still live with its current details — nothing has been taken down.
        An admin reviews the change and it goes out once they approve it. We&apos;ll email you
        either way.
      </p>
      <p className="text-[0.8rem] text-text-muted leading-relaxed">
        Editing again before then replaces this proposal rather than adding a second one.
      </p>

      {remindAboutLuma && (
        <div className="rounded-lg border border-signal/40 bg-signal-muted px-4 py-3 text-[0.8rem] text-text-primary leading-relaxed">
          <span className="font-medium">One more thing —</span> people who already registered
          signed up on Luma, not here, so this change doesn&apos;t reach them. Update your Luma
          event as well.
          {lumaLink && (
            <>
              {" "}
              <a
                href={externalHref(lumaLink)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-light underline"
              >
                Open it
              </a>
              .
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href="/my-submissions"
          className="inline-flex items-center rounded-lg border border-border-strong bg-white/[0.05] px-4 py-2 text-[0.8rem] text-text-primary no-underline transition-colors hover:bg-white/[0.10] hover:border-accent"
        >
          Your submissions
        </Link>
      </div>
    </div>
  );
}
