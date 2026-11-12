"use server";

import type { Result } from "@/lib/result";
import type { SubmissionMode } from "@/lib/actions/guardSubmission";
import { submitListing, updateOwnListing } from "@/lib/listings/user";

// Used only by toggleOpportunityBookmark below, which is opportunity-only
// (bookmarks exist for no other listing type) and so stays here.
import { createClient } from "@/lib/supabase/server";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { currentUser } from "@/lib/auth/currentUser";

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

export async function updateOwnOpportunity(id: string, payload: unknown, editVersion?: number): Promise<Result<{ staged: boolean }>> {
  return updateOwnListing("opportunity", id, payload, editVersion);
}

type ToggleResult =
  | { ok: true; bookmarked: boolean }
  | { ok: false; error: string };

export async function toggleOpportunityBookmark(opportunityId: string): Promise<ToggleResult> {
  const supabase = await createClient();
  const { user } = await currentUser(supabase);
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
    return { ok: true, bookmarked: false };
  }

  const { error } = await supabase
    .from("opportunity_bookmarks")
    .insert({ user_id: user.id, opportunity_id: opportunityId });
  // 23505: a concurrent tap (another tab) inserted it between the lookup
  // and here. The bookmark exists, which is what was asked for (S0).
  if (error && error.code !== "23505") return { ok: false, error: describeSupabaseError(error) };
  // No revalidatePath: in a server action it re-renders the CALLING page
  // into the response, so every bookmark click re-ran the whole
  // /opportunities listing (262 KB, E1b Stage 1). Nothing needs it: both
  // callers update optimistically, /my-bookmarks drops the card itself,
  // and a Link navigation always refetches a dynamic page.
  return { ok: true, bookmarked: true };
}
