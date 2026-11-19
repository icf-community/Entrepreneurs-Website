"use client";

import { ButtonLink } from "@/components/ui/ButtonLink";
import { Panel } from "@/components/ui/Panel";
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
    <Panel size="lg" className="grid gap-5 p-8">
      <h2 className="font-display text-heading text-text-primary">
        Your changes are with an admin
      </h2>
      <p className="max-w-[62ch] text-body leading-relaxed text-text-secondary">
        Your {noun} is still live with its current details — nothing has been taken down.
        An admin reviews the change and it goes out once they approve it. We&apos;ll email you
        either way.
      </p>
      <p className="max-w-[62ch] text-small leading-relaxed text-text-muted">
        Editing again before then replaces this proposal rather than adding a second one.
      </p>

      {remindAboutLuma && (
        <div className="max-w-[62ch] rounded-lg border border-lit-line bg-lit-muted px-5 py-4 text-body leading-relaxed text-text-primary">
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
                className="text-accent-light underline underline-offset-4"
              >
                Open it
              </a>
              .
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/my-submissions" variant="ghost" size="sm">
          Your submissions
        </ButtonLink>
      </div>
    </Panel>
  );
}
