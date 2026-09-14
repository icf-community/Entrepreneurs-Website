"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/actionAuth";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { ok, err, type Result } from "@/lib/result";

export type IngestionStatus = {
  enabled: boolean;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
};

export async function getIngestionStatus(): Promise<Result<IngestionStatus>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase.rpc("admin_get_ingestion_status");
  if (error) return err(describeSupabaseError(error));
  const row = data?.[0];
  return ok({
    enabled: row?.enabled ?? true,
    lastChangedAt: row?.last_changed_at ?? null,
    lastChangedBy: row?.last_changed_by ?? null,
  });
}

export async function setIngestionEnabled(enabled: boolean): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { error } = await auth.supabase.rpc("admin_set_ingestion_enabled", { p_enabled: enabled });
  if (error) return err(describeSupabaseError(error));
  revalidatePath("/admin");
  return ok();
}
