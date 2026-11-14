import { Notice } from "@/components/ui/Notice";

// ════════════════════════════════════════════════════════════════════
// Foundry · "The organiser has proposed a change"
//
// Neutral by design. It names no field and shows no proposed value:
// until an admin has looked, the proposal is unreviewed content and
// putting it on a public page would route around the review this whole
// feature exists to impose.
//
// What it does say is the thing a member needs — that the details below
// may be about to change — so nobody reads a room number the organiser
// already knows is wrong and believes it is settled.
//
// Drawn as an info Notice (the cold light: something to know, not something
// gone wrong) with a clock, announced politely.
// ════════════════════════════════════════════════════════════════════

export function PendingRevisionNotice({ noun }: { noun: string }) {
  return (
    <Notice role="status" tone="info" icon="clock" className="mb-8">
      The organiser has proposed a change to this {noun} and it&apos;s waiting on a review.
      What you see below is the current, approved version — check back before you rely on the
      details.
    </Notice>
  );
}
