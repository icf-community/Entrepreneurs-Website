import "server-only";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/actionAuth";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { emailBaseUrl } from "@/lib/siteUrl";
import {
  sendListingEditProposalEmail,
  sendListingEditDecisionEmail,
} from "@/lib/email";
import { ok, err, type Result } from "@/lib/result";
import { invalidate } from "@/lib/cache";
import { LISTINGS, type ListingKind } from "./registry";

// ════════════════════════════════════════════════════════════════════
// Foundry · The post-approval revision path
//
// 20260907000005 turned "an approved listing is frozen" into "an edit to
// an approved listing is a proposal an admin reviews". The DB does the
// authorisation; this file does the three things it can't:
//
//   • tell the moderation inbox a proposal is waiting,
//   • tell the organiser the outcome,
//   • drop the caches an applied revision makes stale — the same
//     invalidate + revalidatePath pair updateOwnListing already does,
//     because an approved edit that sits behind a cache is invisible.
// ════════════════════════════════════════════════════════════════════

/** One row of the admin queue: the published values and the proposed ones. */
export type ListingEdit = {
  id: string;
  listingKind: ListingKind;
  listingId: string;
  listingTitle: string;
  proposed: Record<string, unknown>;
  current: Record<string, unknown>;
  proposedByName: string | null;
  createdAt: string;
};

/**
 * Field-by-field diff, computed here rather than in SQL so the admin UI
 * and the "fields changed" line in the proposal email agree by
 * construction. Compared as JSON text: the two sides come from the same
 * jsonb builder, so a value that renders identically really is unchanged.
 */
export function changedFields(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): string[] {
  return Object.keys(proposed).filter(
    (k) => JSON.stringify(proposed[k] ?? null) !== JSON.stringify(current[k] ?? null),
  );
}

/** Human labels for the diff view and the notification email. */
export const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  name: "Name",
  position_name: "Position",
  company: "Company",
  description: "Description",
  luma_link: "Luma link",
  event_at: "Date & time",
  location: "Location",
  organiser_name: "Organiser",
  contact_email: "Contact email",
  contact_email_visible: "Contact email visible",
  kind: "Kind",
  link: "Link",
  amount: "Amount",
  deadline: "Deadline",
  stage: "Stage",
  pay: "Pay",
  location_type: "Location type",
  location_text: "Location detail",
  start_month: "Start month",
  start_year: "Start year",
  application_deadline: "Application deadline",
  apply_method: "Apply via",
  apply_url: "Apply URL",
  skill_ids: "Skills",
  sector_ids: "Sectors",
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/**
 * Whether a revision moved an event's time or place. Drives the Luma
 * reminder — the one thing Foundry cannot do for the organiser, because
 * the people who registered are on Luma and not in this database.
 */
export function movesEventLogistics(
  kind: ListingKind,
  fields: string[],
): boolean {
  return kind === "event" && fields.some((f) => f === "event_at" || f === "location");
}

type EditRow = {
  id: string;
  listing_kind: ListingKind;
  listing_id: string;
  listing_title: string;
  proposed: unknown;
  current_values: unknown;
  proposed_by_name: string | null;
  created_at: string;
};

function toEdit(r: EditRow): ListingEdit {
  return {
    id: r.id,
    listingKind: r.listing_kind,
    listingId: r.listing_id,
    listingTitle: r.listing_title,
    proposed: (r.proposed ?? {}) as Record<string, unknown>,
    current: (r.current_values ?? {}) as Record<string, unknown>,
    proposedByName: r.proposed_by_name,
    createdAt: r.created_at,
  };
}

export async function listPendingListingEdits(): Promise<ListingEdit[]> {
  const auth = await requireAdmin();
  if (!auth.ok) return [];
  const { data, error } = await auth.supabase.rpc("admin_list_listing_edits");
  if (error) {
    console.error("admin_list_listing_edits failed:", error.message);
    return [];
  }
  return ((data ?? []) as EditRow[]).map(toEdit);
}

/**
 * Called after a member's update_* RPC staged a revision instead of
 * writing through. Failure here is logged, never surfaced: the proposal
 * is already committed, and telling the organiser their edit failed
 * because an email didn't send would be a lie.
 */
export async function notifyEditProposed(args: {
  kind: ListingKind;
  listingTitle: string;
  proposerName: string | null;
  changed: string[];
}): Promise<void> {
  try {
    await sendListingEditProposalEmail({
      listingKind:   LISTINGS[args.kind].emailKind,
      listingTitle:  args.listingTitle,
      proposerName:  args.proposerName,
      changedFields: args.changed.map(fieldLabel),
      siteUrl:       emailBaseUrl(),
    });
  } catch (e) {
    console.error("listing edit proposal notice failed to queue:", e);
  }
}

async function reviewEdit(
  editId: string,
  decision: "applied" | "rejected",
  reason: string | null,
): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return err(auth.error);

  // Read the revision here rather than accepting it from the caller.
  // The DB authorises on p_edit_id alone, so a client-supplied copy
  // could not forge a decision — but it *could* steer which paths get
  // revalidated and whether the Luma reminder goes out, and neither of
  // those should be a client's to choose.
  const edit = (await listPendingListingEdits()).find((e) => e.id === editId) ?? null;

  const { data, error } =
    decision === "applied"
      ? await auth.supabase.rpc("admin_apply_listing_edit", { p_edit_id: editId })
      : await auth.supabase.rpc("admin_reject_listing_edit", {
          p_edit_id: editId,
          p_reason: reason ?? "",
        });
  if (error) return err(describeSupabaseError(error));

  // Committed. Everything below is notification and cache hygiene, so a
  // failure past this point is reported without pretending the decision
  // didn't happen.
  if (edit && decision === "applied") {
    const def = LISTINGS[edit.listingKind];
    await invalidate(...def.cacheKeys);
    revalidatePath(def.revalidate.public);
    revalidatePath(`${def.revalidate.public}/${edit.listingId}`);
  }
  revalidatePath("/admin/edits");
  revalidatePath("/my-submissions");

  const row = (Array.isArray(data) ? data[0] : data) as
    | { email: string | null; first_name: string | null; title: string }
    | null
    | undefined;
  if (!row?.email) {
    console.warn(`${decision} listing edit ${editId}: no organiser email returned`);
    return ok();
  }

  try {
    await sendListingEditDecisionEmail({
      to:            row.email,
      firstName:     row.first_name,
      listingKind:   LISTINGS[edit?.listingKind ?? "event"].emailKind,
      listingTitle:  row.title,
      decision,
      reason,
      remindAboutLuma: !!edit
        && decision === "applied"
        && movesEventLogistics(edit.listingKind, changedFields(edit.current, edit.proposed)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Decision saved, but the organiser's email failed to queue: ${msg}`);
  }

  return ok();
}

export async function applyListingEdit(editId: string): Promise<Result> {
  return reviewEdit(editId, "applied", null);
}

export async function rejectListingEdit(editId: string, reason: string): Promise<Result> {
  const trimmed = reason.trim();
  if (!trimmed) return err("A reason is required so the organiser knows what to change.");
  return reviewEdit(editId, "rejected", trimmed);
}
