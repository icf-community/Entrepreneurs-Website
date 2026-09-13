import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";
import type { ListingKind } from "@/lib/listings/registry";

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

const EDIT_KIND = {
  opportunity: "opportunity",
  event:       "event",
  vc_grant:    "vc_grant",
} as const satisfies Record<ListingKind, "opportunity" | "event" | "vc_grant">;

export async function hasPendingRevision(
  supabase: SupabaseClient<Database>,
  kind: ListingKind,
  listingId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("listing_has_pending_edit", {
    p_kind: EDIT_KIND[kind],
    p_listing_id: listingId,
  });
  if (error) {
    // A banner is not worth failing a page over.
    console.error("listing_has_pending_edit failed:", error.message);
    return false;
  }
  return data === true;
}

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
