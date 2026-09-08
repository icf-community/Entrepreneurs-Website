import { formatDate } from "@/lib/dates";

// ════════════════════════════════════════════════════════════════════
// Foundry · What editing this listing will actually do
//
// One line under the edit page's heading, and one banner when a revision
// is already queued. Shared by the three edit pages so the promise made
// to organisers cannot drift between event, opportunity and VC/grant.
//
// Before 20260907000005 the copy here said "once an admin approves it,
// it'll be locked", which was true and is now false. Getting this wrong
// in the other direction is worse: an organiser who believes a fix is
// live when it is queued will not chase it.
// ════════════════════════════════════════════════════════════════════

export function EditStatusNote({
  status,
  noun,
}: {
  status: "pending" | "approved";
  noun: string;
}) {
  if (status === "pending") {
    return (
      <p className="text-[0.85rem] text-text-muted mt-2">
        This {noun} hasn&apos;t been reviewed yet, so changes save straight away.
      </p>
    );
  }
  return (
    <p className="text-[0.85rem] text-text-muted mt-2">
      This {noun} is live. Changes to a published {noun} go to an admin first — yours
      stays up exactly as it is until they approve the new version.
    </p>
  );
}

export function QueuedRevisionBanner({ queuedAt }: { queuedAt: string }) {
  return (
    <div
      role="status"
      className="mb-8 rounded-lg border border-signal/40 bg-signal-muted px-4 py-3 text-[0.8rem] text-text-primary leading-relaxed"
    >
      <span className="font-medium">Changes awaiting review.</span> You proposed a change on{" "}
      {formatDate(queuedAt)} and an admin hasn&apos;t looked at it yet. The version below is what
      you proposed — saving again replaces it rather than queueing a second change.
    </div>
  );
}
