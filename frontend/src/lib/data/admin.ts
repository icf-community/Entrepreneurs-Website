import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { UserStatus } from "@/lib/database.overrides";
import type { Affiliation } from "@/lib/intake/steps";
import { rows, type Db } from "./query";
import {
  adminFacets,
  filterArgs,
  type Facets,
  type MemberFilters,
} from "./directory";

// ════════════════════════════════════════════════════════════════════
// Foundry · The admin reads
//
// Three things live here, and each was duplicated somewhere.
//
// 1. THE SIGNUP-EMAIL JOIN, written out three times — in the events, the
//    opportunities and the VCs queue, identically. auth.users is not
//    exposed through PostgREST, so an admin who needs to contact a poster
//    has to go through admin_get_signup_emails (SECURITY DEFINER, gated
//    on is_admin()). Every queue therefore collects poster ids, calls it,
//    builds a Map and reads the Map back in its mapper. That is a lot of
//    identical wiring for one field.
//
// 2. THE HAND-WRITTEN RawRow TYPES. All four of these RPCs are fully
//    described in database.types.ts, and all four pages ignored that and
//    cast to a locally typed shape instead — so a renamed column stayed
//    green at build time and read `undefined` at runtime. Going through
//    rows() restores the check.
//
// 3. THE DASHBOARD COUNTS, four near-identical head:true queries with
//    their own error handling.
//
// Note on nullability: the generated Returns types say `poster_first_name:
// string`, because `supabase gen types` cannot see that the column comes
// from a left join and may be absent. The Row types below therefore widen
// those fields back to `string | null`, and the `?? ""` fallbacks are
// real rather than decorative. Do not "simplify" them away because the
// generated type looks non-null — it is the generated type that is wrong,
// and the same widening is already used by lib/data/events.ts.
// ════════════════════════════════════════════════════════════════════

/** The poster block every review card renders. */
type PosterRow = {
  poster_first_name: string | null;
  poster_surname: string | null;
  poster_linkedin_url: string | null;
};

function toPoster(r: PosterRow, signupEmail: string | null) {
  return {
    firstName:   r.poster_first_name ?? "",
    surname:     r.poster_surname    ?? "",
    linkedinUrl: r.poster_linkedin_url,
    signupEmail,
  };
}

// ────────────────────────────────────────────────────────────────────
// Dashboard counts
// ────────────────────────────────────────────────────────────────────

/**
 * `head: true` responses carry the number in `count` and nothing in
 * `data`, so rows() has nothing to work with. Local rather than added to
 * query.ts: the dashboard is the only place that counts.
 */
async function countOf(
  source: string,
  run: () => PromiseLike<{ count: number | null; error: PostgrestError | null }>,
): Promise<number> {
  const { count, error } = await run();
  if (error) {
    console.error(`Failed to count ${source}:`, error);
    return 0;
  }
  return count ?? 0;
}

export type PendingCounts = {
  profiles: number;
  opportunities: number;
  events: number;
  vcs: number;
  /** Proposed changes to listings that are already published. */
  edits: number;
  /** All five added up — what the header badge shows. */
  total: number;
};

/** The queue depths behind the admin dashboard tiles. */
export async function pendingCounts(db: Db): Promise<PendingCounts> {
  const [profiles, opportunities, events, vcs, edits] = await Promise.all([
    countOf("profiles (pending_review)", () =>
      db.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending_review")),
    countOf("opportunities (pending)", () =>
      db.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "pending")),
    countOf("events (pending)", () =>
      db.from("events").select("id", { count: "exact", head: true }).eq("status", "pending")),
    countOf("vcs_grants (pending)", () =>
      db.from("vcs_grants").select("id", { count: "exact", head: true }).eq("status", "pending")),
    // listing_edits is deny-all RLS, so a head-count through PostgREST
    // would read 0 for everyone. The RPC is the only door, and it
    // returns the queue itself — which is small by construction, since
    // a listing can have at most one open revision.
    pendingEditCount(db),
  ]);

  return {
    profiles,
    opportunities,
    events,
    vcs,
    edits,
    total: profiles + opportunities + events + vcs + edits,
  };
}

async function pendingEditCount(db: Db): Promise<number> {
  const { data, error } = await db.rpc("admin_list_listing_edits");
  if (error) {
    // 42501 is the RPC's own "Forbidden: not an admin" raise, which a
    // non-admin loading /admin reaches before the page 404s them. That is
    // the expected path, not a fault: the four sibling counts above are
    // PostgREST reads that RLS quietly returns 0 rows for, so logging this
    // one made every non-admin probe of /admin write an error nobody should
    // be paged about. Anything else is genuinely wrong and still surfaces.
    if (error.code !== "42501") console.error("Failed to count listing edits:", error);
    return 0;
  }
  return data?.length ?? 0;
}

// ────────────────────────────────────────────────────────────────────
// Signup emails
// ────────────────────────────────────────────────────────────────────

/**
 * Signup email per user id, for the poster block on a review card.
 *
 * Skips the round trip entirely for an empty queue — passing `[]` would
 * be a pointless call, and the three queues all guarded against it by
 * hand before.
 */
export async function signupEmails(db: Db, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const data = await rows("admin_get_signup_emails", () =>
    db.rpc("admin_get_signup_emails", { p_user_ids: userIds }));
  return new Map(data.map((r) => [r.user_id, r.email]));
}

/** The ids to look up, deduplicated — one email per poster, not per row. */
async function signupEmailsFor(db: Db, rowsIn: { posted_by: string }[]): Promise<Map<string, string>> {
  return signupEmails(db, Array.from(new Set(rowsIn.map((r) => r.posted_by))));
}

// ────────────────────────────────────────────────────────────────────
// Review queues
// ────────────────────────────────────────────────────────────────────

type PendingEventRow = PosterRow & {
  id: string;
  title: string;
  description: string;
  luma_link: string;
  event_at: string;
  location: string;
  organiser_name: string;
  contact_email: string;
  contact_email_visible: boolean;
  posted_by: string;
  created_at: string;
};

function toEventReviewItem(r: PendingEventRow, signupEmail: string | null) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    lumaLink: r.luma_link,
    eventAt: r.event_at,
    location: r.location,
    organiserName: r.organiser_name,
    contactEmail: r.contact_email,
    contactEmailVisible: r.contact_email_visible,
    postedBy: toPoster(r, signupEmail),
    createdAt: r.created_at,
  };
}

export type EventReviewItem = ReturnType<typeof toEventReviewItem>;

/**
 * The pending events queue.
 *
 * Admin-only RPC — it raises if the caller is not an admin, and the
 * column-level grant on contact_email is revoked from `authenticated`,
 * so this is the only path to that field (migration 20260530000002).
 */
export async function listPendingEvents(db: Db): Promise<EventReviewItem[]> {
  const data = await rows("list_pending_events_admin", () => db.rpc("list_pending_events_admin"));
  const emails = await signupEmailsFor(db, data);
  return data.map((r) => toEventReviewItem(r, emails.get(r.posted_by) ?? null));
}

type PendingOpportunityRow = PosterRow & {
  id: string;
  position_name: string;
  company: string;
  pay: string;
  location_type: "remote" | "hybrid" | "onsite";
  location_text: string | null;
  description: string;
  start_month: number;
  start_year: number;
  application_deadline: string;
  contact_email: string;
  contact_email_visible: boolean;
  apply_method: "email" | "link";
  apply_url: string | null;
  posted_by: string;
  created_at: string;
  skill_names: string[] | null;
  sector_names: string[] | null;
};

function toOpportunityReviewItem(r: PendingOpportunityRow, signupEmail: string | null) {
  return {
    id: r.id,
    positionName: r.position_name,
    company: r.company,
    pay: r.pay,
    locationType: r.location_type,
    locationText: r.location_text,
    description: r.description,
    startMonth: r.start_month,
    startYear: r.start_year,
    applicationDeadline: r.application_deadline,
    contactEmail: r.contact_email,
    contactEmailVisible: r.contact_email_visible,
    applyMethod: r.apply_method,
    applyUrl: r.apply_url,
    postedBy: toPoster(r, signupEmail),
    skills:  r.skill_names  ?? [],
    sectors: r.sector_names ?? [],
    createdAt: r.created_at,
  };
}

export type OpportunityReviewItem = ReturnType<typeof toOpportunityReviewItem>;

/** The pending opportunities queue. Same admin-only RPC contract as above. */
export async function listPendingOpportunities(db: Db): Promise<OpportunityReviewItem[]> {
  const data = await rows("list_pending_opportunities_admin", () =>
    db.rpc("list_pending_opportunities_admin"));
  const emails = await signupEmailsFor(db, data);
  return data.map((r) => toOpportunityReviewItem(r, emails.get(r.posted_by) ?? null));
}

type PendingVcRow = {
  id: string;
  kind: "vc" | "grant";
  name: string;
  description: string;
  link: string;
  amount: string | null;
  deadline: string | null;
  stage: string | null;
  posted_by: string;
  created_at: string;
  profiles: { first_name: string; surname: string; linkedin_url: string | null } | null;
};

function toVcReviewItem(r: PendingVcRow, signupEmail: string | null) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    description: r.description,
    link: r.link,
    amount: r.amount,
    deadline: r.deadline,
    stage: r.stage,
    postedBy: {
      firstName:   r.profiles?.first_name ?? "",
      surname:     r.profiles?.surname    ?? "",
      linkedinUrl: r.profiles?.linkedin_url ?? null,
      signupEmail,
    },
    createdAt: r.created_at,
  };
}

export type VcReviewItem = ReturnType<typeof toVcReviewItem>;

/**
 * The pending VCs and grants queue.
 *
 * A table select rather than an RPC, and the one read here whose row type
 * is not schema-checked: supabase-js mis-infers the embedded many-to-one
 * on `profiles:posted_by`, exactly as lib/data/vcs.ts documents for the
 * public listing. The cast stays at the call site rather than hiding in
 * rows(), so it is visible to whoever changes this select next.
 */
export async function listPendingVcs(db: Db): Promise<VcReviewItem[]> {
  const data = (await rows("vcs_grants (pending)", () =>
    db
      .from("vcs_grants")
      .select(`
        id, kind, name, description, link,
        amount, deadline, stage,
        posted_by, created_at,
        profiles:posted_by ( first_name, surname, linkedin_url )
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1000),
  )) as unknown as PendingVcRow[];

  const emails = await signupEmailsFor(db, data);
  return data.map((r) => toVcReviewItem(r, emails.get(r.posted_by) ?? null));
}

// ────────────────────────────────────────────────────────────────────
// Pending member profiles (paged)
// ────────────────────────────────────────────────────────────────────

type PendingProfileRow = {
  id: string;
  first_name: string;
  surname: string;
  role: Affiliation;
  course: string | null;
  grad_year: number | null;
  bio: string | null;
  working_on: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  created_at: string;
  skill_names: string[] | null;
  sector_names: string[] | null;
  total_count: number;
};

export function toPendingMember(r: PendingProfileRow) {
  return {
    id: r.id,
    firstName: r.first_name,
    surname: r.surname,
    role: r.role,
    course: r.course,
    gradYear: r.grad_year,
    bio: r.bio,
    workingOn: r.working_on,
    linkedinUrl: r.linkedin_url,
    githubUrl: r.github_url,
    portfolioUrl: r.portfolio_url,
    // admin_list_pending_profiles also returns `email`, deliberately not
    // mapped: nothing on the review card renders it, and a field put on
    // these props is a field serialised into the RSC payload sent to the
    // browser. Add it here only alongside something that shows it.
    createdAt: r.created_at,
    skills:  r.skill_names  ?? [],
    sectors: r.sector_names ?? [],
  };
}

export type PendingMember = ReturnType<typeof toPendingMember>;

export type PendingProfilesPage = {
  items: PendingMember[];
  /** The whole queue, not just this page. */
  total: number;
};

/**
 * One page of the alumni verification queue.
 *
 * Paged in Postgres. The unbounded version was silently capped at
 * PostgREST's max_rows — a queue that stops showing its own backlog past
 * a thousand entries, with nothing to say so. Oldest first: whoever has
 * waited longest gets reviewed first.
 */
export async function listPendingProfiles(
  db: Db,
  { limit, offset }: { limit: number; offset: number },
): Promise<PendingProfilesPage> {
  const data = await rows("admin_list_pending_profiles", () =>
    db.rpc("admin_list_pending_profiles", { p_limit: limit, p_offset: offset }));

  return {
    items: data.map(toPendingMember),
    // total_count rides on every row via a window function, so it is
    // absent exactly when the queue is empty.
    total: data[0]?.total_count ?? 0,
  };
}

// ────────────────────────────────────────────────────────────────────
// The full membership (paged) — /admin/members
// ────────────────────────────────────────────────────────────────────

/** One screen of rows. A table, not cards, so larger than the directory's. */
export const ADMIN_MEMBERS_PAGE_SIZE = 50;

/** The directory filters plus the one an admin has and a member does not. */
export type AdminMemberFilters = MemberFilters & { statuses: string[] };

type AdminProfileRow = {
  id: string;
  first_name: string;
  surname: string;
  role: Affiliation;
  status: UserStatus;
  course: string | null;
  grad_year: number | null;
  email: string | null;
  is_committee: boolean;
  committee_role: string | null;
  created_at: string;
  skill_names: string[] | null;
  sector_names: string[] | null;
  total_count: number;
};

export function toAdminMember(r: AdminProfileRow) {
  return {
    id:        r.id,
    firstName: r.first_name,
    surname:   r.surname,
    role:      r.role,
    status:    r.status,
    course:    r.course,
    gradYear:  r.grad_year,
    // Unlike the review cards, the signup email is mapped here on
    // purpose: the admin table renders it in a column, and contacting a
    // member is what this page is for.
    email:     r.email,
    isCommittee:   r.is_committee,
    committeeRole: r.committee_role,
    createdAt: r.created_at,
    skills:    r.skill_names  ?? [],
    sectors:   r.sector_names ?? [],
  };
}

export type AdminMember = ReturnType<typeof toAdminMember>;

export type AdminMemberPage = {
  members: AdminMember[];
  facets: Facets;
  /** Members matching the current filters, not members overall. */
  matching: number;
};

/**
 * One page of the full membership, at every status.
 *
 * Filtering, searching and paging all happen in Postgres. They have to:
 * this page used to select every profile and filter the array in the
 * browser, which PostgREST silently truncated at max_rows — so past a
 * thousand members, the page an admin uses to find someone was the page
 * that could no longer find them. See migration 20260826000004.
 *
 * No cache, unlike the member directory: these rows include pending and
 * rejected profiles and the signup email, none of which belongs in a
 * shared cache.
 */
export async function adminMemberPage(
  db: Db,
  filters: AdminMemberFilters,
): Promise<AdminMemberPage> {
  const [data, facets] = await Promise.all([
    rows("admin_list_profiles", () =>
      db.rpc("admin_list_profiles", {
        ...filterArgs(filters),
        p_statuses: filters.statuses.length ? filters.statuses : undefined,
        p_limit:    ADMIN_MEMBERS_PAGE_SIZE,
        p_offset:   (filters.page - 1) * ADMIN_MEMBERS_PAGE_SIZE,
      })),
    adminFacets(db),
  ]);

  return {
    members: data.map(toAdminMember),
    facets,
    matching: data[0]?.total_count ?? 0,
  };
}
