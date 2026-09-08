"use server";

import type { Result } from "@/lib/result";
import { applyListingEdit, rejectListingEdit } from "@/lib/listings/edits";

// Thin "use server" wrappers, matching the other admin queues: the logic
// lives in lib/listings/edits.ts, and a "use server" module's exports
// *are* its action endpoints.

export async function approveEdit(editId: string): Promise<Result> {
  return applyListingEdit(editId);
}

export async function declineEdit(editId: string, reason: string): Promise<Result> {
  return rejectListingEdit(editId, reason);
}
