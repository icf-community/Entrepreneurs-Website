import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";
import type { ListingKind } from "./registry";

// The organiser's own queued revision, if there is one. Owner-scoped in
// the RPC (20260907000005), so this returns null for anyone else's
// listing without needing a check here.
//
// Kept out of listings/edits.ts on purpose: that module pulls in the
// email and cache layers for the admin review path, and an edit page
// only needs to read one row.

export type PendingRevision = {
  id: string;
  proposed: Record<string, unknown>;
  current: Record<string, unknown>;
  createdAt: string;
};

const EDIT_KIND = {
  opportunity: "opportunity",
  event:       "event",
  vc_grant:    "vc_grant",
} as const satisfies Record<ListingKind, "opportunity" | "event" | "vc_grant">;

export async function pendingRevision(
  supabase: SupabaseClient<Database>,
  kind: ListingKind,
  listingId: string,
): Promise<PendingRevision | null> {
  const { data, error } = await supabase.rpc("get_my_pending_listing_edit", {
    p_kind: EDIT_KIND[kind],
    p_listing_id: listingId,
  });
  if (error) {
    // Non-fatal: the edit form still works, it just starts from the live
    // values. Failing the whole page over a banner would be worse.
    console.error("get_my_pending_listing_edit failed:", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) ?? null;
  if (!row) return null;
  return {
    id: row.id,
    proposed: (row.proposed ?? {}) as Record<string, unknown>,
    current: (row.current_values ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}
