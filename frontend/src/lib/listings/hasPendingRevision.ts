import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";
import type { ListingKind } from "@/lib/listings/registry";

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
