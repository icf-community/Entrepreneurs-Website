"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { check, type RateBucket } from "@/lib/ratelimit";
import { ok, err, type Result } from "@/lib/result";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { sendConnectionAcceptedEmail, sendConnectionReportEmail } from "@/lib/email";
import {
  sendRequestSchema,
  respondSchema,
  reportConnectionSchema,
  connectionIdSchema,
  memberIdSchema,
  settingsSchema,
  validateConnection,
} from "@/lib/validation/connections";
import {
  decodeCursor,
  myConnectionsPage,
  myPendingRequestsPage,
  mySentRequestsPage,
  type Connection,
  type PendingRequest,
  type SentRequest,
} from "@/lib/data/connections";
import type { MemberFilters } from "@/lib/data/directory";

// ════════════════════════════════════════════════════════════════════
// Foundry · Connections actions
//
// The whole feature exists to exchange one thing — a login email address
// — between two members who each agreed to it. So these actions are not
// the security boundary and must not be read as one: every rule that
// matters (the caps, the cooldowns, the byte-identical refusals, the
// approved-at-accept re-check, the consent-version stamp) is enforced
// inside the SECURITY DEFINER RPCs, in the same transaction as the write.
// A direct PostgREST call reaches those and never reaches this file.
//
// What this layer adds is the three things SQL cannot do: the Upstash
// outer guard, the email that the RPC deliberately does not send (mail is
// never sent from SQL — 20260531000004 made enqueue_outbound_email an open
// relay once already), and a sentence a member can read.
//
// Error text comes from the database wherever the database has an opinion.
// The refusal messages are byte-identical by design — blocked, on
// cooldown, paused and no-such-member all say the same thing — and
// rewording them here would reopen the probing oracle the SQL closed.
// ════════════════════════════════════════════════════════════════════

/**
 * Identity + approved membership. Never `auth.uid() is not null`: a ban
 * here is `status = 'rejected'` and GoTrue's banned_until can take an
 * hour to invalidate an already-issued JWT, so a just-banned member still
 * arrives with a perfectly valid session.
 */
async function guardMember(noun: string) {
  const { user, isAdmin, status, supabase } = await getActionAuth();
  if (!user) return err(`You must be signed in to ${noun}.`);
  if (!isAdmin && status !== "approved") {
    return err("Your membership must be approved before you can use connections.");
  }
  return ok({ supabase, user, isAdmin });
}

/**
 * Rate limit with all three outcomes handled.
 *
 * Both connection buckets fail CLOSED, so an Upstash outage falls back to
 * the in-process limiter rather than refusing — but if that path itself
 * reports "unavailable" the member must not be told they are going too
 * fast. That message would be false, would blame them for an outage, and
 * would make the failure indistinguishable from the feature working.
 */
async function guardRate(bucket: RateBucket, userId: string, limitedMessage: string) {
  const decision = await check(bucket, userId);
  if (decision === "limited") return err(limitedMessage);
  if (decision === "unavailable") {
    Sentry.captureMessage(
      `${bucket} rate-limit bucket unreachable — connection writes are being refused (fail-closed)`,
      { level: "error", tags: { bucket, surface: "connections" } },
    );
    return err("We can't do that right now. Please try again in a few minutes.");
  }
  return ok();
}

// Every write touches at least one of these surfaces: the tab you are on,
// the other party's badge, and the member dialog's button state. Cheap,
// and the alternative is a stale Connect button that errors when pressed.
function revalidateConnections() {
  revalidatePath("/connections");
  revalidatePath("/members");
  revalidatePath("/home");
}

// ─── Send ───────────────────────────────────────────────────────────
// Idempotent by design: sending twice returns the same connection id
// rather than erroring, because the request existing is what the member
// wanted either way.
//
// consentVersion is passed straight through from the client. It is NOT
// re-read here, and that is the point — it identifies the wording the
// member actually saw, and the RPC refuses anything that is not current
// with "please refresh". Re-reading it server-side would stamp today's
// version against yesterday's copy and make the Art. 7(1) evidence a lie.
export async function sendConnectionRequest(
  payload: unknown,
): Promise<Result<{ connectionId: string }>> {
  const guard = await guardMember("send a connection request");
  if (!guard.ok) return guard;
  const { supabase, user } = guard.data;

  const parsed = validateConnection(sendRequestSchema, payload);
  if (!parsed.ok) return parsed;

  // Deliberately above the database's own daily cap of 10, so a member at
  // their limit meets the RPC's specific sentence rather than this
  // generic one. Reaching this message means something is wrong or
  // someone is scripting.
  const rate = await guardRate(
    "connectionRequest",
    user.id,
    "You've sent a lot of connection requests today. Try again tomorrow.",
  );
  if (!rate.ok) return rate;

  const { data, error } = await supabase.rpc("send_connection_request", {
    p_addressee: parsed.data.memberId,
    p_consent_version: parsed.data.consentVersion,
    // `?? undefined` rather than null: both mean "no note" to the RPC
    // (the parameter defaults to null), and the generated types make an
    // argument with a SQL default optional rather than nullable.
    p_note: parsed.data.note ?? undefined,
  });
  if (error) return err(describeSupabaseError(error));
  if (!data) return err("Your request could not be sent. Please try again.");

  revalidateConnections();
  return ok({ connectionId: data });
}

// ─── Respond ────────────────────────────────────────────────────────
// Accept is the disclosure. The RPC returns the requester's identity and
// address because that is the only way this action can send the notice —
// SQL never sends mail — and because after the update the caller has no
// other route to it.
//
// A DECLINE NOTIFIES NOBODY. No email, no event the sender can see, no
// trace in their sent list. That is what makes declining socially free,
// and it is the reason the decline rate drives nothing automatic either.
export async function respondToConnectionRequest(
  payload: unknown,
): Promise<Result<{ accepted: boolean }>> {
  const guard = await guardMember("respond to a connection request");
  if (!guard.ok) return guard;
  const { supabase, user } = guard.data;

  const parsed = validateConnection(respondSchema, payload);
  if (!parsed.ok) return parsed;

  const rate = await guardRate(
    "connectionRespond",
    user.id,
    "You've done that a lot today. Try again in a little while.",
  );
  if (!rate.ok) return rate;

  const { data, error } = await supabase.rpc("respond_to_connection_request", {
    p_id: parsed.data.connectionId,
    p_accept: parsed.data.accept,
    p_consent_version: parsed.data.consentVersion,
  });
  if (error) return err(describeSupabaseError(error));

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    revalidateConnections();
    return err("That request is no longer pending.");
  }

  if (row.accepted && row.requester_email) {
    // The decision is already committed. A mail failure must not fail the
    // action or the member would press Accept again on a request that is
    // no longer pending and be told it vanished. Logged loudly instead:
    // the address is visible in the app either way, so the notice is a
    // convenience, not the disclosure itself.
    try {
      await sendConnectionAcceptedEmail({
        to: row.requester_email,
        firstName: row.requester_first_name ?? null,
        accepterName: [row.accepter_first_name, row.accepter_surname]
          .filter(Boolean)
          .join(" ")
          .trim() || "A member",
        accepterEmail: user.email ?? "",
        appUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.imperialentrepreneurs.com",
      });
    } catch (e) {
      Sentry.captureException(e, {
        level: "error",
        tags: { surface: "connections", path: "accept-notification" },
      });
    }
  }

  revalidateConnections();
  return ok({ accepted: !!row.accepted });
}

// ─── Withdraw ───────────────────────────────────────────────────────
// Requester only. Carries the same 21-day cooldown a decline does, so
// withdraw-and-resend is not a way around it.
export async function withdrawConnectionRequest(payload: unknown): Promise<Result> {
  const guard = await guardMember("withdraw a request");
  if (!guard.ok) return guard;
  const { supabase, user } = guard.data;

  const parsed = validateConnection(connectionIdSchema, payload);
  if (!parsed.ok) return parsed;

  const rate = await guardRate(
    "connectionRespond",
    user.id,
    "You've done that a lot today. Try again in a little while.",
  );
  if (!rate.ok) return rate;

  const { error } = await supabase.rpc("withdraw_connection_request", {
    p_id: parsed.data.connectionId,
  });
  if (error) return err(describeSupabaseError(error));

  revalidateConnections();
  return ok();
}

// ─── Remove ─────────────────────────────────────────────────────────
// Either party, and mutual: it disappears from both sides at once. The
// row is NOT deleted on the spot — it becomes `removed` with a 21-day
// cooldown and is hard-deleted by cron afterwards, because otherwise
// remove-and-re-request is a harassment loop bounded only by the daily
// cap.
export async function removeConnection(payload: unknown): Promise<Result> {
  const guard = await guardMember("remove a connection");
  if (!guard.ok) return guard;
  const { supabase, user } = guard.data;

  const parsed = validateConnection(connectionIdSchema, payload);
  if (!parsed.ok) return parsed;

  const rate = await guardRate(
    "connectionRespond",
    user.id,
    "You've done that a lot today. Try again in a little while.",
  );
  if (!rate.ok) return rate;

  const { error } = await supabase.rpc("remove_connection", { p_id: parsed.data.connectionId });
  if (error) return err(describeSupabaseError(error));

  revalidateConnections();
  return ok();
}

// ─── Block / unblock ────────────────────────────────────────────────
// Block is a DISTINCT control from decline, deliberately. Buried inside a
// decline flow, people decline when they mean to block and the signal
// that drives the reputation throttle goes quiet — which is the one
// automated protection the feature has.
//
// It is silent to the other party and permanent until the blocker undoes
// it, and it removes any existing connection.
export async function blockMember(payload: unknown): Promise<Result> {
  const guard = await guardMember("block a member");
  if (!guard.ok) return guard;
  const { supabase, user } = guard.data;

  const parsed = validateConnection(memberIdSchema, payload);
  if (!parsed.ok) return parsed;

  const rate = await guardRate(
    "connectionRespond",
    user.id,
    "You've done that a lot today. Try again in a little while.",
  );
  if (!rate.ok) return rate;

  const { error } = await supabase.rpc("block_member", { p_member: parsed.data.memberId });
  if (error) return err(describeSupabaseError(error));

  revalidateConnections();
  return ok();
}

// Silently a no-op when the caller is not the blocker — the RPC decides
// that, and it does so without saying which case it was, because "you did
// not block them" and "they blocked you" must not be distinguishable.
export async function unblockMember(payload: unknown): Promise<Result> {
  const guard = await guardMember("unblock a member");
  if (!guard.ok) return guard;
  const { supabase, user } = guard.data;

  const parsed = validateConnection(memberIdSchema, payload);
  if (!parsed.ok) return parsed;

  const rate = await guardRate(
    "connectionRespond",
    user.id,
    "You've done that a lot today. Try again in a little while.",
  );
  if (!rate.ok) return rate;

  const { error } = await supabase.rpc("unblock_member", { p_member: parsed.data.memberId });
  if (error) return err(describeSupabaseError(error));

  revalidateConnections();
  return ok();
}

// ─── Report ─────────────────────────────────────────────────────────
// The RPC snapshots the note text at report time, because remove hard-
// deletes the row eventually and a report pointing at a deleted
// connection would otherwise be unadjudicable.
//
// IT NOTIFIES THE MODERATION INBOX, exactly as reportPost does. The
// argument for not doing so was that a connection report is not public
// content — nothing is visible to anybody else and nothing needs taking
// down urgently — and that argument is wrong on the duty that actually
// applies. The optional note makes this user-to-user content, so the
// Online Safety Act's illegal-content duty attaches: act once you KNOW.
// A threatening note has already reached the person it was aimed at, and
// "we find out when an admin next opens a page" is not knowing. The
// volume that would make an inbox learn to ignore it does not exist here
// either: 10 reports per member per day, hard-capped in the RPC.
//
// Sent only when a row was genuinely filed (20260917000008), so a
// double-click does not produce a second notification.
export async function reportConnection(payload: unknown): Promise<Result> {
  const guard = await guardMember("report a connection");
  if (!guard.ok) return guard;
  const { supabase, user } = guard.data;

  const parsed = validateConnection(reportConnectionSchema, payload);
  if (!parsed.ok) return parsed;

  // The same bucket community reports use. Report-bombing is the abuse
  // case, and it does not become a different problem because the surface
  // changed — a member with more than a handful of genuine reports in a
  // day is an outlier worth an admin noticing either way.
  const rate = await guardRate(
    "postReport",
    user.id,
    "You've reported several things today. If something urgent needs attention, email us.",
  );
  if (!rate.ok) return rate;

  const { data, error } = await supabase.rpc("report_connection", {
    p_id: parsed.data.connectionId,
    p_category: parsed.data.category,
    p_reason: parsed.data.reason,
  });
  if (error) return err(describeSupabaseError(error));

  const row = Array.isArray(data) ? data[0] : data;

  // The report is already committed by this point, so a mail failure must
  // not fail the action: the member did their part, and telling them
  // otherwise would invite them to file it again. Logged loudly instead,
  // because an unrouted report is a compliance problem.
  if (row?.filed) {
    try {
      await sendConnectionReportEmail({
        category: parsed.data.category,
        reason: parsed.data.reason,
        reportedName: row.reported_name ?? "",
        reportedAt: new Date(),
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.imperialentrepreneurs.com",
      });
    } catch (e) {
      Sentry.captureException(e, {
        level: "error",
        tags: { surface: "connections", path: "report-notification" },
      });
    }
  }

  revalidatePath("/admin/connections");
  revalidateConnections();
  return ok();
}

// ─── Settings ───────────────────────────────────────────────────────
// Two independent switches, both on `profiles`, both nullable in the RPC
// so a toggle only writes the column it owns.
//
//   connection_emails_enabled — the digest opt-out. Not politeness: auth
//     mail and digests share one sending domain, so spam complaints on
//     digests degrade SIGN-IN deliverability.
//   open_to_connections — a pause switch. Committee members, mentors and
//     angels get the most requests; without this their only options are
//     declining forty of them or disengaging. Existing connections and
//     pending requests are unaffected.
//
// No rate bucket: it writes two booleans on the caller's own row, the
// coarse `mutations` backstop in proxy.ts already caps it, and a limit
// here would spend Upstash commands to re-enforce that.
export async function updateConnectionSettings(payload: unknown): Promise<Result> {
  const guard = await guardMember("change your settings");
  if (!guard.ok) return guard;
  const { supabase } = guard.data;

  const parsed = validateConnection(settingsSchema, payload);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.rpc("set_connection_settings", {
    // Same as p_note above: omitted means "leave this column alone",
    // which is exactly what the null default does in SQL.
    p_emails_enabled: parsed.data.emailsEnabled ?? undefined,
    p_open: parsed.data.openToConnections ?? undefined,
  });
  if (error) return err(describeSupabaseError(error));

  revalidatePath("/settings");
  revalidateConnections();
  return ok();
}

// ─── Load more ──────────────────────────────────────────────────────
// Keyset paging, driven from the client so a longer scroll appends
// rather than replacing the page. Same shape as loadMoreFeed in
// community/actions.ts, and the cursor is decoded defensively for the
// same reason: it arrives from the browser, and a bad one means "start
// at the top", never an error.
//
// These are reads behind a server action rather than a route handler
// because they need the caller's session and the RPCs are the only way
// to that data — `connections` is RLS deny-all with no policies.
export async function loadMoreConnections(
  cursor: string,
  filters: MemberFilters,
): Promise<Result<{ connections: Connection[]; nextCursor: string | null }>> {
  const guard = await guardMember("view your connections");
  if (!guard.ok) return guard;

  const decoded = decodeCursor(cursor);
  if (!decoded) return err("Couldn't load more. Refresh the page to start again.");

  const page = await myConnectionsPage(guard.data.supabase, filters, decoded);
  return ok({ connections: page.connections, nextCursor: page.nextCursor });
}

export async function loadMorePendingRequests(
  cursor: string,
): Promise<Result<{ requests: PendingRequest[]; nextCursor: string | null }>> {
  const guard = await guardMember("view your requests");
  if (!guard.ok) return guard;

  const decoded = decodeCursor(cursor);
  if (!decoded) return err("Couldn't load more. Refresh the page to start again.");

  const page = await myPendingRequestsPage(guard.data.supabase, decoded);
  return ok({ requests: page.requests, nextCursor: page.nextCursor });
}

export async function loadMoreSentRequests(
  cursor: string,
): Promise<Result<{ requests: SentRequest[]; nextCursor: string | null }>> {
  const guard = await guardMember("view your requests");
  if (!guard.ok) return guard;

  const decoded = decodeCursor(cursor);
  if (!decoded) return err("Couldn't load more. Refresh the page to start again.");

  const page = await mySentRequestsPage(guard.data.supabase, decoded);
  return ok({ requests: page.requests, nextCursor: page.nextCursor });
}
