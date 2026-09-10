"use client";

import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";

// ════════════════════════════════════════════════════════════════════
// Foundry · "Your CV won't reach recruiters" warning
//
// Fires when a member presses Continue past the CV screen with a file
// attached but the parse-consent checkbox unticked. Unlike
// SkipWarningDialog, this DOES fire for students: confirm_cv_upload
// (20260906000001) only opens a cvs row — and so only runs any of the
// recruiter-matching pipeline — when that box is ticked, so an
// attached-but-unconsented CV satisfies validate()'s "a CV is present"
// check for a compulsory student CV while silently doing nothing the
// requirement actually exists for. Nothing else would ever tell them.
//
// Never auto-ticks the box on the member's behalf — that's their choice
// to make, not something a dialog should decide for them; the dialog's
// job is only to make sure the consequence was actually seen.
//
// Shown at most once per session (IntakeFlow tracks this with its own
// consentWarned flag, separate from skipWarned) — a second Continue
// press proceeds without re-nagging.
// ════════════════════════════════════════════════════════════════════

export function ConsentWarningDialog({
  onTickNow,
  onContinueAnyway,
}: {
  onTickNow: () => void;
  onContinueAnyway: () => void;
}) {
  return (
    <Dialog
      onClose={onTickNow}
      label="Your CV won't be used for matching"
      className="w-full max-w-[480px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto p-7"
    >
      <h2 className="mb-3 font-display text-[1.2rem] text-text-primary">
        That CV won&apos;t reach recruiters
      </h2>

      <p className="mb-4 text-[0.85rem] leading-[1.65] text-text-secondary">
        You&apos;ve attached a CV but haven&apos;t ticked the box to let us read it. Without that, we
        can&apos;t generate the summary recruiters search to find you — even though your CV will still
        be on file. You can tick it now, or leave it unticked and add your skills yourself from the
        next screen instead.
      </p>

      <p className="mb-6 text-[0.8rem] leading-[1.6] text-text-muted">
        You can change this any time by re-uploading your CV from your profile page.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" size="md" onClick={onTickNow}>
          Tick it now
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onContinueAnyway}>
          Continue anyway
        </Button>
      </div>
    </Dialog>
  );
}
