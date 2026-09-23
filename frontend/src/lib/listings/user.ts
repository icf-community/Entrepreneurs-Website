import "server-only";
import { revalidatePath } from "next/cache";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";
import { guardSubmission, type SubmissionMode } from "@/lib/actions/guardSubmission";
import { ok, err, type Result } from "@/lib/result";
import { LISTINGS, type ListingKind } from "./registry";
import { changedFields, notifyEditProposed } from "./edits";
import { invalidate } from "@/lib/cache";

// ════════════════════════════════════════════════════════════════════
// Foundry · Member-facing listing writes, once instead of three times
//
// The ceremony around each write — guard, call, revalidate the right two
// paths — was identical in all three app/*/actions.ts files. What differs
// per type (schema, RPC, argument mapping) lives in the registry.
// ════════════════════════════════════════════════════════════════════

export async function submitListing(
  kind: ListingKind,
  args: { mode: SubmissionMode; payload: unknown; turnstileToken?: string },
): Promise<Result> {
  const def = LISTINGS[kind];

  const guard = await guardSubmission({
    mode: args.mode,
    noun: def.submitNoun,
    turnstileToken: args.turnstileToken,
  });
  if (!guard.ok) return guard;

  const res = await def.create(guard.data.supabase, args.mode, args.payload);
  if (!res.ok) return res;

  // An admin-mode create publishes immediately, so it can land in a cached
  // list. A user-mode create only enqueues something pending, which no
  // cached list contains — invalidating anyway keeps this one code path.
  await invalidate(...def.cacheKeys);
  revalidatePath(def.revalidate.public);
  if (args.mode === "admin") revalidatePath(def.revalidate.admin);
  return ok();
}

// Edit one of your own listings. Ownership and status are enforced
// inside the RPC — since 20260826000001 all three types work this way,
// which is what lets this be one function.
//
// Since 20260907000005 the same call has two outcomes: a pending listing
// is edited in place, and an approved one has the change staged as a
// revision for an admin to review while the published version stays up.
// Which one happened is read back from the database rather than inferred
// from the status the page rendered with — an approval that lands
// mid-edit would otherwise make the confirmation lie.
export async function updateOwnListing(
  kind: ListingKind,
  id: string,
  payload: unknown,
): Promise<Result<{ staged: boolean }>> {
  const def = LISTINGS[kind];

  const { user, supabase, unreachable } = await getActionAuth();
  if (unreachable) return err(UNREACHABLE_MESSAGE);
  if (!user) return err("You must be signed in.");

  const res = await def.update(supabase, id, payload);
  if (!res.ok) return res;

  const { data: pending } = await supabase.rpc("get_my_pending_listing_edit", {
    p_kind: EDIT_KIND[kind],
    p_listing_id: id,
  });
  const revision = (Array.isArray(pending) ? pending[0] : pending) ?? null;

  if (revision) {
    // Nothing published changed, so no public cache is stale. What is
    // needed is a human: this is the one notification on the path, and
    // it is deliberately immediate rather than batched.
    const current  = (revision.current_values ?? {}) as Record<string, unknown>;
    const proposed = (revision.proposed ?? {}) as Record<string, unknown>;
    await notifyEditProposed({
      kind,
      listingTitle: String(current.title ?? current.name ?? current.position_name ?? "(untitled)"),
      proposerName: await proposerDisplayName(supabase, user.id),
      changed: changedFields(current, proposed),
    });
    revalidatePath("/my-submissions");
    return ok({ staged: true });
  }

  await invalidate(...def.cacheKeys);
  revalidatePath("/my-submissions");
  revalidatePath(def.revalidate.public);
  return ok({ staged: false });
}

// listing_event_kind in the database uses the same three labels as
// ListingKind. Restated rather than cast so a future divergence is a
// compile error here instead of a runtime 404 from PostgREST.
const EDIT_KIND = {
  opportunity: "opportunity",
  event:       "event",
  vc_grant:    "vc_grant",
} as const satisfies Record<ListingKind, "opportunity" | "event" | "vc_grant">;

async function proposerDisplayName(
  supabase: Awaited<ReturnType<typeof getActionAuth>>["supabase"],
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("first_name, surname")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return [data.first_name, data.surname].filter(Boolean).join(" ").trim() || null;
}
