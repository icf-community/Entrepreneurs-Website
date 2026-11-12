"use server";

import type { BulkResult } from "@/app/admin/bulkTypes";
import type { Result } from "@/lib/result";
import {
  approveListing, rejectListing, bulkApproveListings, bulkRejectListings,
} from "@/lib/listings/admin";

// Thin "use server" wrappers. The logic lives in lib/listings/admin.ts,
// once for all three types; these exports have to stay because a
// "use server" module's exports *are* its action endpoints, and the
// review cards import them by name.
//
// What differs between the types is in lib/listings/registry.ts.

export async function approveOpportunity(id: string, editVersion: number): Promise<Result> {
  return approveListing("opportunity", id, editVersion);
}

export async function rejectOpportunity(id: string, reason: string): Promise<Result> {
  return rejectListing("opportunity", id, reason);
}

export async function bulkApproveOpportunities(items: { id: string; editVersion: number }[]): Promise<BulkResult> {
  return bulkApproveListings("opportunity", items);
}

export async function bulkRejectOpportunities(ids: string[], reason: string): Promise<BulkResult> {
  return bulkRejectListings("opportunity", ids, reason);
}
