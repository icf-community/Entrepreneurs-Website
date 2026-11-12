"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { invalidate } from "@/lib/cache";
import { requireAdmin } from "@/lib/auth/actionAuth";
import { sendAccountRemovalEmail } from "@/lib/email";
import { describeSupabaseError } from "@/lib/supabaseErrors";

type Result = { ok: true } | { ok: false; error: string };

export async function adminDeleteUser(userId: string, reason: string): Promise<Result> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };

  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { supabase } = auth;
  const { data, error } = await supabase.rpc("admin_delete_user", {
    p_user_id: userId,
    p_reason:  trimmed,
  });
  if (error) return { ok: false, error: describeSupabaseError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.email) {
    // react-doctor-disable-next-line server-after-nonblocking -- synchronous logging call in an edge-case branch, not fire-and-forget async work; all real async side effects in this function are already awaited before returning
    console.warn("admin_delete_user returned no email for user:", userId);
    // Membership changed, so the cached directory is stale.
    await invalidate("directoryFacets");
    revalidatePath("/admin/members");
    return { ok: true };
  }

  try {
    await sendAccountRemovalEmail({
      to:        row.email,
      firstName: row.first_name ?? null,
      reason:    trimmed,
    });
  } catch (e) {
    Sentry.captureException(e, { level: "error", tags: { surface: "admin", path: "delete-user-email" } });
    const msg = e instanceof Error ? e.message : String(e);
    // Membership changed, so the cached directory is stale.
    await invalidate("directoryFacets");
    revalidatePath("/admin/members");
    return { ok: false, error: `User deleted, but email failed to send: ${msg}` };
  }
  // Membership changed, so the cached directory is stale.
  await invalidate("directoryFacets");
  revalidatePath("/admin/members");
  return { ok: true };
}

/**
 * Escalate, edit, or revert a member's committee status.
 *
 * Setting isCommittee false always clears the role with it, mirroring
 * admin_set_committee's own guard — a later re-escalation should never
 * resurrect a title nobody re-entered.
 *
 * Committee members are excluded from list_directory_cards, so both the
 * directory cache and /members itself go stale here, same as /committee.
 */
export async function adminSetCommittee(
  memberId: string,
  isCommittee: boolean,
  committeeRole: string,
): Promise<Result> {
  if (isCommittee && !committeeRole.trim()) {
    return { ok: false, error: "A committee role is required." };
  }

  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { supabase } = auth;
  const { error } = await supabase.rpc("admin_set_committee", {
    p_member_id: memberId,
    p_is_committee: isCommittee,
    p_committee_role: isCommittee ? committeeRole.trim() : undefined,
  });
  if (error) return { ok: false, error: describeSupabaseError(error) };

  await invalidate("directoryFacets");
  revalidatePath("/admin/members");
  revalidatePath("/members");
  revalidatePath("/committee");
  return { ok: true };
}
