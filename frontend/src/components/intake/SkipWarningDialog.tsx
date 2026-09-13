"use client";

import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";

// ════════════════════════════════════════════════════════════════════
// Foundry · "You've given us neither" warning
//
// Fires when a member presses Continue past the CV/GitHub screens having
// supplied neither — but ONLY where both are genuinely optional.
//
// A student's CV is compulsory (20260901000013: submit_intake and
// defer_intake both raise without it), so for them a missing CV still
// hits IntakeFlow's hard validation error instead. Showing a dismissible
// "are you sure?" for something the server will refuse anyway would be
// actively misleading — it implies a choice that doesn't exist.
//
// Shown at most once per screen per session: a second Continue press
// proceeds. The point is to make sure the consequence was seen, not to
// argue with someone who has already decided.
// ════════════════════════════════════════════════════════════════════

export function SkipWarningDialog({
  onAddNow,
  onSkip,
}: {
  onAddNow: () => void;
  onSkip: () => void;
}) {
  return (
    <Dialog
      onClose={onAddNow}
      label="You haven't added a CV or GitHub"
      className="w-full max-w-[480px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto p-7"
    >
      <h2 className="mb-3 font-display text-[1.2rem] text-text-primary">
        Recruiters won&apos;t be able to find you
      </h2>

      <p className="mb-4 text-[0.85rem] leading-[1.65] text-text-secondary">
        You haven&apos;t given us your CV or your GitHub profile — you won&apos;t be visible to
        recruiters for their job postings. If you&apos;d rather not do it here, you can always upload
        your CV and connect GitHub from your profile page later.
      </p>

      <p className="mb-6 text-[0.8rem] leading-[1.6] text-text-muted">
        You can change which projects you spotlight to recruiters any time, and we&apos;ll email you
        when there&apos;s something new worth adding — at most once a month.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" size="md" onClick={onAddNow}>
          Add it now
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
    </Dialog>
  );
}
