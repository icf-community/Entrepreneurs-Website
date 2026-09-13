"use server";

import type { Result } from "@/lib/result";
import type { SubmissionMode } from "@/lib/actions/guardSubmission";
import { submitListing, updateOwnListing } from "@/lib/listings/user";

// Used only by toggleOpportunityBookmark below, which is opportunity-only
// (bookmarks exist for no other listing type) and so stays here.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describeSupabaseError } from "@/lib/supabaseErrors";

// Thin "use server" wrappers. The logic lives in lib/listings/user.ts,
// once for all three types, and what differs between them is in
// lib/listings/registry.ts. These exports have to stay: a "use server"
// module's exports *are* its action endpoints, and the forms import them
// by name.
//
// Why a server action rather than a client-side supabase.from().update():
// we want a stable RPC boundary that translates cleanly to a FastAPI
// endpoint later. Client-direct PostgREST writes are migration-hostile,
// being tied to Supabase's SDK and RLS shape rather than an HTTP contract.

export async function submitOpportunity(
  args: { mode: SubmissionMode; payload: unknown; turnstileToken?: string },
): Promise<Result> {
  return submitListing("opportunity", args);
}

export async function updateOwnOpportunity(id: string, payload: unknown): Promise<Result<{ staged: boolean }>> {
  return updateOwnListing("opportunity", id, payload);
}

type ToggleResult =
  | { ok: true; bookmarked: boolean }
  | { ok: false; error: string };

export async function toggleOpportunityBookmark(opportunityId: string): Promise<ToggleResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Look up current state — single round trip is cheap and lets us
  // decide insert-vs-delete without relying on the unique-violation
  // error code as control flow.
  const { data: existing, error: lookupErr } = await supabase
    .from("opportunity_bookmarks")
    .select("opportunity_id")
    .eq("user_id", user.id)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (lookupErr) return { ok: false, error: describeSupabaseError(lookupErr) };

  if (existing) {
    const { error } = await supabase
      .from("opportunity_bookmarks")
      .delete()
      .eq("user_id", user.id)
      .eq("opportunity_id", opportunityId);
    if (error) return { ok: false, error: describeSupabaseError(error) };
    revalidatePath("/my-bookmarks");
    return { ok: true, bookmarked: false };
  }

  const { error } = await supabase
    .from("opportunity_bookmarks")
    .insert({ user_id: user.id, opportunity_id: opportunityId });
  if (error) return { ok: false, error: describeSupabaseError(error) };
  revalidatePath("/my-bookmarks");
  return { ok: true, bookmarked: true };
}
