"use server";

import { requireAdmin } from "@/lib/auth/actionAuth";
import { invalidate } from "@/lib/cache";
import { ok, err, type Result } from "@/lib/result";
import { describeSupabaseError } from "@/lib/supabaseErrors";

// ════════════════════════════════════════════════════════════════════
// Foundry · Publishing the incident banner (launch programme F-x4)
//
// The RPCs re-check is_admin() and validate everything (length, https-only
// link, known severity, future hide time) and log to admin_actions; this
// layer exists for the early refusal and to drop the cached copy, so the
// change reaches /api/banner at once (the CDN adds at most 15 seconds).
// ════════════════════════════════════════════════════════════════════

export type BannerInput = {
  message: string;
  severity: "info" | "warning" | "critical";
  linkUrl: string;
  /** ISO timestamp, or "" for no expiry. */
  hideAfter: string;
};

export async function publishSiteBanner(input: BannerInput): Promise<Result<{ version: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return err(auth.error);

  const { data, error } = await auth.supabase.rpc("admin_set_site_banner", {
    p_message: input.message,
    p_severity: input.severity,
    p_link_url: input.linkUrl.trim() || undefined,
    p_hide_after: input.hideAfter || undefined,
  });
  // 22023 is the RPC's own validation, written to be shown as-is.
  if (error) return err(error.code === "22023" ? error.message : describeSupabaseError(error));

  await invalidate("siteBanner");
  return ok({ version: data as number });
}

export async function clearSiteBanner(): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return err(auth.error);

  const { error } = await auth.supabase.rpc("admin_clear_site_banner");
  if (error) return err(describeSupabaseError(error));

  await invalidate("siteBanner");
  return ok();
}
