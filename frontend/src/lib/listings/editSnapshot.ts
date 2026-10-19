import "server-only";
import type { Db } from "@/lib/data/query";
import type { Database } from "@/lib/database.overrides";
import type { ListingKind } from "./registry";
import { throwIfUnreachable } from "@/lib/supabase/unavailable";

type Tables = Database["public"]["Tables"];
type EditRows = {
  event: Tables["events"]["Row"];
  opportunity: Tables["opportunities"]["Row"] & { skill_ids: number[]; sector_ids: number[] };
  vc_grant: Tables["vcs_grants"]["Row"];
};
export async function listingEditSnapshot<K extends ListingKind>(db: Db, kind: K, id: string) {
  const args: Database["public"]["Functions"]["get_my_listing_edit"]["Args"] = { p_kind: kind, p_id: id };
  const res = await db.rpc("get_my_listing_edit", args);
  throwIfUnreachable("get_my_listing_edit", res);
  if (res.error) throw new Error("Failed to load listing edit snapshot");
  return res.data as { row: EditRows[K]; revision: { id: string; proposed: Record<string, unknown>; createdAt: string } | null } | null;
}
