import "server-only";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/actionAuth";
import {
  sendListingRejectionEmail,
  renderListingRejectionEmail,
  listingRejectionReplyTo,
} from "@/lib/email";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { ok, err, type Result } from "@/lib/result";
import type { BulkResult } from "@/app/admin/bulkTypes";
import { runBulk } from "@/lib/admin/bulk";
import { LISTINGS, type ListingKind, type RejectedPoster } from "./registry";
import { invalidate } from "@/lib/cache";

// ════════════════════════════════════════════════════════════════════
// Foundry · Admin review actions, once instead of three times
//
// Everything here was written out in each of the three
// app/admin/*/actions.ts files with a noun changed. Those files now hold
// only the thin "use server" exports the review cards import by name —
// which have to stay, because a "use server" module's exports *are* the
// action endpoints.
// ════════════════════════════════════════════════════════════════════

export async function approveListing(kind: ListingKind, id: string, editVersion: number): Promise<Result> {
  const def = LISTINGS[kind];
  const auth = await requireAdmin();
  if (!auth.ok) return err(auth.error);

  const { error } = await def.approve(auth.supabase, id, editVersion);
  if (error) return err(describeSupabaseError(error));

  // Cache first, then Next's path revalidation: a re-render triggered by
  // revalidatePath must not be able to read the stale entry and put it
  // straight back.
  await invalidate(...def.cacheKeys);
  revalidatePath(def.revalidate.admin);
  revalidatePath(def.revalidate.public);
  return ok();
}

export async function rejectListing(
  kind: ListingKind,
  id: string,
  reason: string,
): Promise<Result> {
  const def = LISTINGS[kind];
  const trimmed = reason.trim();
  if (!trimmed) return err("Rejection reason is required.");

  const auth = await requireAdmin();
  if (!auth.ok) return err(auth.error);

  const { data, error } = await def.reject(auth.supabase, id, trimmed);
  if (error) return err(describeSupabaseError(error));

  // The rejection itself has already committed at this point. Everything
  // below is the notification, so a failure there is reported without
  // pretending the rejection didn't happen — hence the revalidate on
  // every path out of here.
  await invalidate(...def.cacheKeys);

  const row: RejectedPoster | null = Array.isArray(data) ? data[0] ?? null : data;
  if (!row?.email) {
    console.warn(`reject ${kind}: RPC returned no poster email for`, id);
    revalidatePath(def.revalidate.admin);
    return ok();
  }

  try {
    await sendListingRejectionEmail({
      to:           row.email,
      firstName:    row.first_name ?? null,
      listingKind:  def.emailKind,
      listingTitle: row.title,
      reason:       trimmed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    revalidatePath(def.revalidate.admin);
    return err(`${def.label} rejected, but email failed to send: ${msg}`);
  }

  revalidatePath(def.revalidate.admin);
  return ok();
}

// Authenticated once here, not once per listing. The RPCs re-check
// is_admin() on every call regardless, so the boundary is unchanged —
// what goes away is the repeated getUser + profiles round trip, and the
// per-item cache drop and revalidate that made a large batch time out.
export async function bulkApproveListings(
  kind: ListingKind,
  items: { id: string; editVersion: number }[],
): Promise<BulkResult> {
  const def = LISTINGS[kind];
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase } = auth;

  // Approval notifies nobody, so there is no email stage here.
  const versionById = new Map(items.map((i) => [i.id, i.editVersion]));
  return runBulk(items.map((i) => i.id), {
    one: async (id) => {
      const { error } = await def.approve(supabase, id, versionById.get(id) as number);
      return error
        ? { recipient: null, error: describeSupabaseError(error) }
        : { recipient: null };
    },
    cacheKeys: def.cacheKeys,
    revalidate: [def.revalidate.admin, def.revalidate.public],
  });
}

export async function bulkRejectListings(
  kind: ListingKind,
  ids: string[],
  reason: string,
): Promise<BulkResult> {
  const def = LISTINGS[kind];
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "Rejection reason is required." };
  const { supabase } = auth;

  return runBulk(ids, {
    one: async (id) => {
      const { data, error } = await def.reject(supabase, id, trimmed);
      if (error) return { recipient: null, error: describeSupabaseError(error) };
      const row: RejectedPoster | null = Array.isArray(data) ? data[0] ?? null : data;
      if (!row?.email) {
        console.warn(`bulk reject ${kind}: RPC returned no poster email for`, id);
        return { recipient: null };
      }
      return {
        recipient: { email: row.email, first_name: row.first_name ?? null, title: row.title },
      };
    },
    email: {
      render: (r) => renderListingRejectionEmail({
        firstName:    r.first_name,
        listingKind:  def.emailKind,
        listingTitle: r.title,
        reason:       trimmed,
      }),
      replyTo: listingRejectionReplyTo(),
    },
    cacheKeys: def.cacheKeys,
    revalidate: [def.revalidate.admin, def.revalidate.public],
  });
}
