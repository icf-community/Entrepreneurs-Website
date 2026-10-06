import "server-only";
import { rows, type Db } from "./query";

// Opportunity reads. The shape below is the single declaration of what an
// opportunity is on the client — page, loader and OpportunitiesClient all
// import it from here. It used to exist three times per listing type: a
// hand-written snake_case row type in the page, the mapper's return, and a
// hand-written camelCase type inside the client component.

export type Opportunity = {
  id: string;
  positionName: string;
  company: string;
  pay: string;
  locationType: "remote" | "hybrid" | "onsite";
  locationText: string | null;
  description: string;
  startMonth: number;
  startYear: number;
  applicationDeadline: string;
  contactEmail: string | null;
  applyMethod: "email" | "link";
  applyUrl: string | null;
  /** When the row was added, not its deadline. /home sorts on it. */
  createdAt: string;
  /** id and avatar for "Posted by" + View profile (AI-plan §2); Connect stays inside the dialog. */
  postedBy: { id: string; firstName: string; surname: string; linkedinUrl: string | null; avatarPath: string | null };
  skills: string[];
  sectors: string[];
  /** Who may see and apply: students, graduates or both (AI-plan §7.2). */
  audience: "students" | "graduates" | "both" | null;
};

/**
 * A row from list_approved_opportunities / list_my_bookmarked_opportunities.
 * Both RPCs return the same shape, which is why one mapper serves both —
 * and why toOpportunity previously existed twice, byte-identical.
 *
 * Structural, not hand-written: it is what the generated types say those
 * RPCs return, so a migration that changes a column breaks the build here.
 */
type Row = {
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
  contact_email: string | null;
  apply_method: "email" | "link";
  apply_url: string | null;
  created_at: string;
  posted_by: string;
  poster_first_name: string | null;
  poster_surname: string | null;
  poster_linkedin_url: string | null;
  poster_avatar_path: string | null;
  skill_names: string[] | null;
  sector_names: string[] | null;
  eligible_audience: string | null;
};

export function toOpportunity(r: Row): Opportunity {
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
    // contact_email is already masked by the RPC when visibility is off
    // and the caller isn't the poster / admin.
    contactEmail: r.contact_email,
    applyMethod: r.apply_method,
    applyUrl: r.apply_url,
    createdAt: r.created_at,
    postedBy: {
      id:          r.posted_by,
      firstName:   r.poster_first_name ?? "",
      surname:     r.poster_surname    ?? "",
      linkedinUrl: r.poster_linkedin_url,
      avatarPath:  r.poster_avatar_path,
    },
    skills:  r.skill_names  ?? [],
    sectors: r.sector_names ?? [],
    audience: (r.eligible_audience as Opportunity["audience"]) ?? null,
  };
}

/**
 * Approved, not-yet-expired opportunities.
 *
 * Goes through the SECURITY DEFINER RPC so contact_email is masked in the
 * database, not at the app layer (migration 20260530002). It also filters
 * to application_deadline >= current_date, so expired roles drop out
 * without anyone having to prune them.
 */
/** What a /home card shows — and nothing viewer-dependent, so no contact_email. */
export type NewestOpportunity = Pick<Opportunity, "id" | "positionName" | "company" | "locationType" | "locationText" | "createdAt">;

/**
 * The most recently added open opportunities, for /home.
 *
 * Its own RPC rather than list_approved_opportunities() sliced in JS:
 * that shipped every open role, descriptions and all, to show three
 * (20260917000019).
 */
export async function newestOpportunities(db: Db, limit = 3): Promise<NewestOpportunity[]> {
  const data = await rows("list_newest_opportunities", () =>
    db.rpc("list_newest_opportunities", { p_limit: limit }));
  return data.map((r) => ({
    id:           r.id,
    positionName: r.position_name,
    company:      r.company,
    locationType: r.location_type,
    locationText: r.location_text,
    createdAt:    r.created_at,
  }));
}

export async function listApprovedOpportunities(db: Db): Promise<Opportunity[]> {
  const data = await rows("list_approved_opportunities", () =>
    db.rpc("list_approved_opportunities"),
  );
  return data.map(toOpportunity);
}

/**
 * The current user's bookmarked opportunities, still open.
 *
 * The reason toOpportunity was written to serve two RPCs: this returns
 * the same shape as list_approved_opportunities (plus a `bookmarked_at`
 * nothing renders), so /my-bookmarks and /opportunities render from one
 * mapper instead of the two byte-identical copies they had before.
 *
 * Same SECURITY DEFINER masking of contact_email (migrations
 * 20260530000002 and 20260530000005).
 */
export async function listBookmarkedOpportunities(db: Db): Promise<Opportunity[]> {
  const data = await rows("list_my_bookmarked_opportunities", () =>
    db.rpc("list_my_bookmarked_opportunities"),
  );
  return data.map(toOpportunity);
}

/** Ids of the opportunities this user has bookmarked. */
export async function bookmarkedOpportunityIds(db: Db, userId: string): Promise<string[]> {
  const data = await rows("opportunity_bookmarks", () =>
    db.from("opportunity_bookmarks").select("opportunity_id").eq("user_id", userId),
  );
  return data.map((r) => r.opportunity_id);
}

/**
 * The one opportunity the poster is editing, or null.
 *
 * Same SECURITY DEFINER contract as eventForEdit: the RPC enforces
 * caller = poster, so an id belonging to someone else comes back empty.
 */
export async function opportunityForEdit(db: Db, id: string) {
  const data = await rows("get_opportunity_for_edit", () =>
    db.rpc("get_opportunity_for_edit", { p_id: id }));
  return data[0] ?? null;
}

/**
 * One approved, still-open opportunity the viewer may see, or null.
 *
 * An ID-specific read (AI-plan §7.2): the old list-and-find missed jobs
 * past the list's 1,000-row cap. Same SECURITY DEFINER contract as the
 * list — contact_email masked, the audience applied — so a closed role, a
 * job outside the viewer's audience and an unknown id all come back null,
 * and /opportunities/[id] renders "no longer available".
 */
export async function approvedOpportunity(db: Db, id: string): Promise<Opportunity | null> {
  const data = await rows("get_approved_opportunity", () => db.rpc("get_approved_opportunity", { p_id: id }));
  return data[0] ? toOpportunity(data[0]) : null;
}

/** The viewer's own education status (AI-plan §7.2): unknown means no audience job is visible yet. */
export async function myEducation(db: Db): Promise<{ known: boolean; enrolled: boolean | null; graduated: boolean | null }> {
  const data = await rows("get_my_education", () => db.rpc("get_my_education"));
  const r = data[0];
  return { known: !!r?.known, enrolled: r?.currently_enrolled ?? null, graduated: r?.has_completed_degree ?? null };
}
