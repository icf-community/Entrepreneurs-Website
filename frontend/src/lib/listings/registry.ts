import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { ok, err, type Result } from "@/lib/result";
import type { SubmissionMode } from "@/lib/actions/guardSubmission";
import type { CacheKey } from "@/lib/cache";
import {
  opportunitySchema, eventSchema, vcGrantSchema, validate,
  type OpportunityPayload, type EventPayload, type VcGrantPayload,
} from "@/lib/validation/listings";

// ════════════════════════════════════════════════════════════════════
// Foundry · What differs between the three listing types
//
// Adding a listing type used to mean writing the same admin action file
// a fourth time. The orchestration around each RPC — admin gate, error
// translation, look up the poster, send the rejection email, revalidate
// the two paths — was ~55 lines repeated three times with a noun
// changed, and the copies had drifted.
//
// So the orchestration moves to lib/listings/admin.ts and this file
// holds only what is genuinely per-type.
//
// The RPC calls are stored as closures rather than as RPC *names*. That
// is the load-bearing decision: the three approve RPCs take differently
// named id parameters (p_opportunity_id / p_event_id / p_id), so a
// name-plus-parameter-name registry would have to build its arguments
// dynamically, which is exactly the untyped `Record<string, unknown>`
// pattern that let submitEvent drift away from its schema (see 6c).
// A closure per type keeps every call checked against the generated
// types.
// ════════════════════════════════════════════════════════════════════

export type ListingKind = "opportunity" | "event" | "vc_grant";

type Db = SupabaseClient<Database>;

/** Shape all three reject_* RPCs return: TABLE(email, first_name, title). */
export type RejectedPoster = {
  email: string | null;
  first_name: string | null;
  title: string;
};

export type ListingDef = {
  /** Sentence-case noun for admin-facing messages: "Event rejected, but …". */
  label: string;
  /** Completes "You must be signed in to post …". */
  submitNoun: string;
  /** The wording sendListingRejectionEmail expects. */
  emailKind: "opportunity" | "event" | "VC/grant submission";
  /** Both paths to revalidate after a state change. */
  revalidate: { admin: string; public: string };
  /**
   * Cache entries a write of this type makes stale. Declared here so the
   * generic write paths invalidate without each having to remember, and
   * so a fourth listing type has one place to get this right.
   */
  cacheKeys: readonly CacheKey[];
  approve: (db: Db, id: string) => Promise<{ error: { message?: string; code?: string } | null }>;
  reject: (db: Db, id: string, reason: string) => Promise<{
    data: RejectedPoster[] | RejectedPoster | null;
    error: { message?: string; code?: string } | null;
  }>;
  /**
   * Validate-and-write, kept together per type rather than split into a
   * schema field plus a mapping field. Splitting them would mean the
   * generic caller holds a payload typed as the union of three schemas and
   * hands it to a mapper expecting one of them — which only type-checks by
   * widening to `unknown` somewhere. Here each closure owns its own parse,
   * so `p` is precisely typed at the point the RPC arguments are built.
   */
  create: (db: Db, mode: SubmissionMode, payload: unknown) => Promise<Result>;
  update: (db: Db, id: string, payload: unknown) => Promise<Result>;
};

export const LISTINGS = {
  opportunity: {
    label: "Opportunity",
    submitNoun: "an opportunity",
    emailKind: "opportunity",
    revalidate: { admin: "/admin/opportunities", public: "/opportunities" },
    // The directory shows each member's open roles, sourced from approved
    // opportunities — so approving or editing one changes /community too.
    cacheKeys: ["directoryFacets"],
    approve: async (db, id) => await db.rpc("approve_opportunity", { p_opportunity_id: id, p_notes: null }),
    reject: async (db, id, reason) =>
      await db.rpc("reject_opportunity", { p_opportunity_id: id, p_reason: reason }),
    create: async (db, mode, payload) => {
      const parsed = validate(opportunitySchema, payload);
      if (!parsed.ok) return parsed;
      const rpc = mode === "admin" ? "admin_create_opportunity" : "submit_opportunity";
      const { error } = await db.rpc(rpc, opportunityRpcArgs(parsed.data));
      return error ? err(describeSupabaseError(error)) : ok();
    },
    update: async (db, id, payload) => {
      const parsed = validate(opportunitySchema, payload);
      if (!parsed.ok) return parsed;
      const { error } = await db.rpc("update_opportunity", {
        p_id: id, ...opportunityRpcArgs(parsed.data),
      });
      return error ? err(describeSupabaseError(error)) : ok();
    },
  },
  event: {
    label: "Event",
    submitNoun: "an event",
    emailKind: "event",
    revalidate: { admin: "/admin/events", public: "/events" },
    // Events aren't cached (contact_email is masked per caller), and
    // nothing else derives from them.
    cacheKeys: [],
    approve: async (db, id) => await db.rpc("approve_event", { p_event_id: id, p_notes: null }),
    reject: async (db, id, reason) => await db.rpc("reject_event", { p_event_id: id, p_reason: reason }),
    create: async (db, mode, payload) => {
      const parsed = validate(eventSchema, payload);
      if (!parsed.ok) return parsed;
      const p = parsed.data;
      const args = eventRpcArgs(p);
      // The society flag is admin-only: submit_event has no such parameter,
      // and a DB trigger is the final backstop. Two concrete calls rather
      // than one dynamic argument object — see the note at the top.
      const { error } = mode === "admin"
        ? await db.rpc("admin_create_event", { ...args, p_is_society_event: p.isSocietyEvent ?? false })
        : await db.rpc("submit_event", args);
      return error ? err(describeSupabaseError(error)) : ok();
    },
    update: async (db, id, payload) => {
      const parsed = validate(eventSchema, payload);
      if (!parsed.ok) return parsed;
      const { error } = await db.rpc("update_event", { p_id: id, ...eventRpcArgs(parsed.data) });
      return error ? err(describeSupabaseError(error)) : ok();
    },
  },
  vc_grant: {
    label: "VC/grant",
    submitNoun: "a listing",
    emailKind: "VC/grant submission",
    revalidate: { admin: "/admin/vcs", public: "/vcs" },
    cacheKeys: ["vcs"],
    approve: async (db, id) => await db.rpc("approve_vc_grant", { p_id: id, p_notes: null }),
    reject: async (db, id, reason) => await db.rpc("reject_vc_grant", { p_id: id, p_reason: reason }),
    create: async (db, mode, payload) => {
      const parsed = validate(vcGrantSchema, payload);
      if (!parsed.ok) return parsed;
      const rpc = mode === "admin" ? "admin_create_vc_grant" : "submit_vc_grant";
      const { error } = await db.rpc(rpc, vcGrantRpcArgs(parsed.data));
      return error ? err(describeSupabaseError(error)) : ok();
    },
    update: async (db, id, payload) => {
      const parsed = validate(vcGrantSchema, payload);
      if (!parsed.ok) return parsed;
      const { error } = await db.rpc("update_vc_grant", { p_id: id, ...vcGrantRpcArgs(parsed.data) });
      return error ? err(describeSupabaseError(error)) : ok();
    },
  },
} as const satisfies Record<ListingKind, ListingDef>;

// ─── Payload → RPC argument mapping ─────────────────────────────────
// Shared by each type's create and update, which take the same columns.

function opportunityRpcArgs(p: OpportunityPayload) {
  return {
    p_position_name:         p.positionName,
    p_company:               p.company,
    p_pay:                   p.pay,
    p_location_type:         p.locationType,
    p_location_text:         p.locationText,
    p_description:           p.description,
    p_start_month:           p.startMonth,
    p_start_year:            p.startYear,
    p_application_deadline:  p.applicationDeadline,
    p_contact_email:         p.contactEmail,
    p_contact_email_visible: p.contactEmailVisible,
    p_apply_method:          p.applyMethod,
    p_apply_url:             p.applyUrl,
    p_skill_ids:             p.skillIds,
    p_sector_ids:            p.sectorIds,
    p_eligible_audience:     p.eligibleAudience,
  };
}

function eventRpcArgs(p: EventPayload) {
  return {
    p_title:                 p.title,
    p_description:           p.description,
    p_luma_link:             p.lumaLink,
    p_event_at:              p.eventAtIso,
    p_location:              p.location,
    p_organiser_name:        p.organiserName,
    p_contact_email:         p.contactEmail,
    p_contact_email_visible: p.contactEmailVisible,
  };
}

function vcGrantRpcArgs(p: VcGrantPayload) {
  return {
    p_kind:        p.kind,
    p_name:        p.name,
    p_description: p.description,
    p_link:        p.link,
    p_amount:      p.amount,
    p_deadline:    p.deadline,
    p_stage:       p.stage,
  };
}
