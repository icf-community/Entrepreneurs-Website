"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/actionAuth";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { ok, err, type Result } from "@/lib/result";
import { sendConnectionReportOutcomeEmail } from "@/lib/email";

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

// ════════════════════════════════════════════════════════════════════
// Foundry · Connections admin
//
// Three surfaces, and one of them writes an audit row before it returns
// anything.
// ════════════════════════════════════════════════════════════════════

export type ConnectionsStatus = {
  enabled: boolean;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
};

export async function getConnectionsStatus(): Promise<Result<ConnectionsStatus>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase.rpc("admin_get_connections_status");
  if (error) return err(describeSupabaseError(error));
  const row = data?.[0];
  return ok({
    enabled: row?.enabled ?? true,
    lastChangedAt: row?.last_changed_at ?? null,
    lastChangedBy: row?.last_changed_by ?? null,
  });
}

/**
 * The kill switch. It gates NEW REQUESTS ONLY — accept, decline,
 * withdraw, block, report and remove all keep working while it is off,
 * and the digest keeps running. Otherwise flipping it strands everyone
 * mid-handshake with an inbox they cannot clear.
 */
export async function setConnectionsEnabled(enabled: boolean): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { error } = await auth.supabase.rpc("admin_set_connections_enabled", {
    p_enabled: enabled,
  });
  if (error) return err(describeSupabaseError(error));
  revalidatePath("/admin");
  revalidatePath("/admin/connections");
  return ok();
}

/**
 * Reveals the note a member sent with a connection request.
 *
 * The RPC writes an `admin_actions` row BEFORE it returns the text — the
 * same discipline as `action='view_cv'` — so the audit record exists even
 * if this response is lost on the wire. That ordering is the whole reason
 * this is an action and not a column on the queue: a note is private
 * member-to-member content, and reading one has to cost something
 * visible.
 */
export async function revealConnectionNote(reportId: string): Promise<Result<string>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase.rpc("admin_reveal_connection_note", {
    p_report_id: reportId,
  });
  if (error) return err(describeSupabaseError(error));
  return ok(typeof data === "string" ? data : "");
}

/**
 * Closing a report ALWAYS tells the reporter what happened, for both
 * outcomes — the same discipline as `/admin/reports`. That is the half of
 * a complaints process which is easiest to skip and the half that makes
 * it real: a report route that never reports back trains members to stop
 * using it, and leaves us holding a documented notification with no
 * evidence we acted on it. "We looked and took no action" is a result.
 * Silence is not.
 *
 * `admin_resolve_connection_report` returns the reporter's address and
 * the reported member's name for exactly this, because mail is never sent
 * from SQL (20260531000004 made enqueue_outbound_email an open relay
 * once already).
 */
export async function resolveConnectionReport(
  reportId: string,
  status: "actioned" | "dismissed",
  note: string,
): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const trimmed = note.trim();
  const { data, error } = await auth.supabase.rpc("admin_resolve_connection_report", {
    p_report_id: reportId,
    p_status: status,
    p_note: trimmed || undefined,
  });
  if (error) return err(describeSupabaseError(error));

  const row = Array.isArray(data) ? data[0] : data;

  // The reporter can close their account between reporting and an admin
  // getting to it. Nothing to send, nothing wrong.
  if (!row?.email) {
    revalidatePath("/admin/connections");
    return ok();
  }

  try {
    await sendConnectionReportOutcomeEmail({
      to: row.email,
      firstName: row.first_name ?? null,
      reportedName: row.reported_name ?? "",
      outcome: status,
      note: trimmed || null,
    });
  } catch (e) {
    // The report is resolved either way; only the notice failed. Reported
    // honestly rather than pretending the resolution didn't happen.
    const msg = e instanceof Error ? e.message : String(e);
    revalidatePath("/admin/connections");
    return err(`Report resolved, but the outcome email failed to send: ${msg}`);
  }

  revalidatePath("/admin/connections");
  return ok();
}

/**
 * Lifts an automatic throttle.
 *
 * The throttle is COMPUTED, never stored — a count of distinct members
 * who blocked or successfully reported this sender — so clearing it is an
 * append-only `throttle_cleared` event rather than a flag being unset.
 * Nothing goes stale and there is no un-throttle cron.
 */
export async function clearSenderThrottle(memberId: string, note: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const trimmed = note.trim();
  const { error } = await auth.supabase.rpc("admin_clear_sender_throttle", {
    p_member: memberId,
    p_note: trimmed || undefined,
  });
  if (error) return err(describeSupabaseError(error));
  revalidatePath("/admin/connections");
  return ok();
}
