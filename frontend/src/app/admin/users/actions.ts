"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { invalidate } from "@/lib/cache";
import { requireAdmin } from "@/lib/auth/actionAuth";
import {
  sendAcceptanceEmail, sendRejectionEmail,
  renderAcceptanceEmail, renderRejectionEmail,
  acceptanceReplyTo, rejectionReplyTo,
} from "@/lib/email";
import { emailBaseUrl } from "@/lib/siteUrl";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import type { BulkResult } from "@/app/admin/bulkTypes";
import { runBulk } from "@/lib/admin/bulk";

type Result = { ok: true } | { ok: false; error: string };

export async function approveUser(userId: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { supabase } = auth;

  // is_admin() is verified again inside the RPC; this is defence in depth.
  // Updated approve_user RPC (migration 20260530000004) returns the
  // user's email + first_name so we can send the welcome email in
  // the same round trip.
  const { data, error } = await supabase.rpc("approve_user", {
    p_user_id: userId,
    p_notes:   null,
  });
  if (error) return { ok: false, error: describeSupabaseError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.email) {
    // react-doctor-disable-next-line server-after-nonblocking -- synchronous logging call in an edge-case branch, not fire-and-forget async work; all real async side effects in this function are already awaited before returning
    console.warn("approve_user returned no email for user:", userId);
    // Membership changed, so the cached directory is stale.
    await invalidate("directoryFacets");
    revalidatePath("/admin/users");
    return { ok: true };
  }

  // Build the email link from trusted config, NOT request headers
  // (x-forwarded-host is attacker-controllable → email-link poisoning).
  // Deep-links to /intake, not /home — see renderAcceptanceEmail's own
  // comment for why this email is the one thing that gets an approved
  // alum to their first visit there.
  const appUrl = `${emailBaseUrl()}/intake`;

  try {
    await sendAcceptanceEmail({
      to:           row.email,
      firstName:    row.first_name ?? null,
      appUrl,
    });
  } catch (e) {
    // Approval is committed; surface the email failure so the admin
    // can follow up but don't reverse the approval.
    Sentry.captureException(e, { level: "error", tags: { surface: "admin", path: "approve-user-email" } });
    const msg = e instanceof Error ? e.message : String(e);
    // Membership changed, so the cached directory is stale.
    await invalidate("directoryFacets");
    revalidatePath("/admin/users");
    return { ok: false, error: `User approved, but welcome email failed to queue: ${msg}` };
  }
  // Membership changed, so the cached directory is stale.
  await invalidate("directoryFacets");
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function rejectUser(userId: string, reason: string): Promise<Result> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "Rejection reason is required." };

  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { supabase } = auth;

  // The updated reject_user RPC (migration 6) returns the user's email +
  // first_name so we can email them without a second round-trip.
  const { data, error } = await supabase
    .rpc("reject_user", { p_user_id: userId, p_reason: trimmed });
  if (error) return { ok: false, error: describeSupabaseError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.email) {
    // Status flip succeeded but we couldn't find the email. Don't fail the
    // whole action — the admin's intent is recorded; just log.
    // react-doctor-disable-next-line server-after-nonblocking -- synchronous logging call in an edge-case branch, not fire-and-forget async work; all real async side effects in this function are already awaited before returning
    console.warn("reject_user returned no email for user:", userId);
    // Membership changed, so the cached directory is stale.
    await invalidate("directoryFacets");
    revalidatePath("/admin/users");
    return { ok: true };
  }

  try {
    await sendRejectionEmail({ to: row.email, firstName: row.first_name ?? null });
  } catch (e) {
    // Email failed but DB rejection is already committed. Surface to admin
    // so they know to follow up manually, but don't revert the rejection.
    Sentry.captureException(e, { level: "error", tags: { surface: "admin", path: "reject-user-email" } });
    const msg = e instanceof Error ? e.message : String(e);
    // Membership changed, so the cached directory is stale.
    await invalidate("directoryFacets");
    revalidatePath("/admin/users");
    return { ok: false, error: `User rejected, but email failed to send: ${msg}` };
  }
  // Membership changed, so the cached directory is stale.
  await invalidate("directoryFacets");
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function bulkApproveUsers(ids: string[]): Promise<BulkResult> {
  // Authenticated once here, not once per member. The RPC re-checks
  // is_admin() on every call regardless, so the boundary is unchanged.
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase } = auth;

  const appUrl = `${emailBaseUrl()}/intake`;

  return runBulk(ids, {
    one: async (id) => {
      const { data, error } = await supabase.rpc("approve_user", {
        p_user_id: id,
        p_notes:   null,
      });
      if (error) return { recipient: null, error: describeSupabaseError(error) };
      const row = Array.isArray(data) ? data[0] : data;
      // react-doctor-disable-next-line server-after-nonblocking -- synchronous logging call in an edge-case branch, not fire-and-forget async work; all real async side effects in this function are already awaited before returning
      if (!row?.email) console.warn("approve_user returned no email for user:", id);
      return { recipient: row?.email ? { email: row.email, first_name: row.first_name ?? null } : null };
    },
    email: {
      render:  (r) => renderAcceptanceEmail({ firstName: r.first_name, appUrl }),
      replyTo: acceptanceReplyTo(),
    },
    cacheKeys:  ["directoryFacets"],
    revalidate: ["/admin/users"],
  });
}

export async function bulkRejectUsers(ids: string[], reason: string): Promise<BulkResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "Rejection reason is required." };
  const { supabase } = auth;

  return runBulk(ids, {
    one: async (id) => {
      const { data, error } = await supabase
        .rpc("reject_user", { p_user_id: id, p_reason: trimmed });
      if (error) return { recipient: null, error: describeSupabaseError(error) };
      const row = Array.isArray(data) ? data[0] : data;
      // react-doctor-disable-next-line server-after-nonblocking -- synchronous logging call in an edge-case branch, not fire-and-forget async work; all real async side effects in this function are already awaited before returning
      if (!row?.email) console.warn("reject_user returned no email for user:", id);
      return { recipient: row?.email ? { email: row.email, first_name: row.first_name ?? null } : null };
    },
    email: {
      render:  (r) => renderRejectionEmail({ firstName: r.first_name }),
      replyTo: rejectionReplyTo(),
    },
    cacheKeys:  ["directoryFacets"],
    revalidate: ["/admin/users"],
  });
}
