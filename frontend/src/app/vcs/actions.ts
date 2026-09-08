"use server";

import type { Result } from "@/lib/result";
import type { SubmissionMode } from "@/lib/actions/guardSubmission";
import { submitListing, updateOwnListing } from "@/lib/listings/user";

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

export async function submitVcGrant(
  args: { mode: SubmissionMode; payload: unknown; turnstileToken?: string },
): Promise<Result> {
  return submitListing("vc_grant", args);
}

export async function updateOwnVcGrant(id: string, payload: unknown): Promise<Result<{ staged: boolean }>> {
  return updateOwnListing("vc_grant", id, payload);
}
