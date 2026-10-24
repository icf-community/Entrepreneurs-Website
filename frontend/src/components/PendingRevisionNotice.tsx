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
// ════════════════════════════════════════════════════════════════════

export function PendingRevisionNotice({ noun }: { noun: string }) {
  return (
    <div
      role="status"
      className="mb-8 rounded-lg border border-border-strong bg-white/[0.03] px-4 py-3 text-[0.8rem] text-text-secondary leading-relaxed"
    >
      The organiser has proposed a change to this {noun} and it&apos;s waiting on a review.
      What you see below is the current, approved version — check back before you rely on the
      details.
    </div>
  );
}
