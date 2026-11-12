import "server-only";
import { cached } from "../cache";
import { escapeLike } from "../likeEscape";
import { rows, maybeRow, type Db } from "./query";

export type Vc = {
  id: string;
  kind: "vc" | "grant";
  name: string;
  description: string;
  link: string;
  amount: string | null;
  deadline: string | null;
  stage: string | null;
  postedBy: { firstName: string; surname: string };
};

/** One screen of cards — same size class as the directory's page. */
export const VC_PAGE_SIZE = 24;

/** The filter state /vcs parses out of the URL. */
export type VcFilters = {
  q: string;
  kind: "all" | "vc" | "grant";
  from: string;
  to: string;
  page: number;
};

function vcFilterArgs(f: VcFilters) {
  return {
    p_query: f.q ? escapeLike(f.q) : undefined,
    p_kind:  f.kind === "all" ? undefined : f.kind,
    p_from:  f.from || undefined,
    p_to:    f.to || undefined,
  };
}

export function toVc(r: {
  id: string; kind: "vc" | "grant"; name: string; description: string; link: string;
  amount: string | null; deadline: string | null; stage: string | null;
  poster_first_name: string; poster_surname: string;
}): Vc {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    description: r.description,
    link: r.link,
    amount: r.amount,
    deadline: r.deadline,
    stage: r.stage,
    postedBy: { firstName: r.poster_first_name, surname: r.poster_surname },
  };
}

export type VcsPage = {
  items: Vc[];
  /** VCs/grants matching the current filters, not the approved total. */
  matching: number;
};

/**
 * One page of approved VC/grant listings, filtered and searched in
 * Postgres.
 *
 * Was a single `.limit(1000)` read, cached whole and filtered in the
 * browser — silently truncated past 1,000 rows exactly like the member
 * directory did before migration 20260826000003, just never actually hit
 * at this list's current scale. See 20260904000002 for the RPC.
 *
 * No contact_email or other caller-dependent column on this row shape
 * (see lib/cache.ts's header), so unlike the opportunities/events lists
 * this one needs no masking to be cacheable — only the directory's own
 * "unfiltered first page only" restriction, for the same reason:
 * anything with a search or a filter has too large a key space to cache.
 */
export async function listApprovedVcs(
  db: Db,
  filters: VcFilters,
  { isAdmin = false }: { isAdmin?: boolean } = {},
): Promise<VcsPage> {
  const unfiltered =
    filters.page === 1 && !filters.q && filters.kind === "all" && !filters.from && !filters.to;
  const data = await cached(
    "vcs",
    () => rows("list_approved_vcs_grants", () =>
      db.rpc("list_approved_vcs_grants", {
        ...vcFilterArgs(filters),
        p_limit:  VC_PAGE_SIZE,
        p_offset: (filters.page - 1) * VC_PAGE_SIZE,
      })),
    { skip: isAdmin || !unfiltered, isCacheable: (r) => r.length > 0 },
  );

  return {
    items: data.map(toVc),
    // total_count rides on every row via a window function, so it is
    // absent exactly when the page is empty.
    matching: data[0]?.total_count ?? 0,
  };
}

/**
 * The most recently approved VCs/grants, ignoring every filter — /home's
 * strip. Same RPC as the paged list, unfiltered and capped small.
 *
 * Deliberately NOT cached: it's a different p_limit (3, not VC_PAGE_SIZE)
 * from the "vcs" key above, so sharing that key would serve this call the
 * paged list's cached rows (or vice versa) — same bug the directory avoids
 * by giving directoryFirstPage and directoryNewest separate keys. This
 * query is already cheap (limit 3), so it isn't worth a second key.
 */
export async function newestVcs(db: Db, limit = 3): Promise<Vc[]> {
  const data = await rows("list_approved_vcs_grants (newest)", () =>
    db.rpc("list_approved_vcs_grants", { p_limit: limit, p_offset: 0 }));
  return data.map(toVc);
}

/**
 * One approved VC/grant, or null.
 *
 * A table read rather than an RPC: the `vcs_grants_select_approved` RLS
 * policy already lets any approved member read any approved row directly,
 * same as `vcForEdit` below does for the poster's own row. Two queries
 * rather than an embedded-relation select — see the note that used to
 * live on RawRow in this file — so the FK relation is never asked to type
 * itself through supabase-js's select-string parser.
 */
export async function approvedVc(db: Db, id: string): Promise<Vc | null> {
  const row = await maybeRow("vcs_grants (single)", () =>
    db
      .from("vcs_grants")
      .select("id, kind, name, description, link, amount, deadline, stage, posted_by")
      .eq("id", id)
      .eq("status", "approved")
      .maybeSingle());
  if (!row) return null;

  const poster = await maybeRow("profiles (vc poster)", () =>
    db.from("profiles").select("first_name, surname").eq("id", row.posted_by).maybeSingle());

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    link: row.link,
    amount: row.amount,
    deadline: row.deadline,
    stage: row.stage,
    postedBy: { firstName: poster?.first_name ?? "", surname: poster?.surname ?? "" },
  };
}

/**
 * The one VC/grant the poster is editing, or null.
 *
 * Unlike approvedVc this does not check the poster — it returns posted_by
 * and the caller compares. RLS lets a member read approved rows and their
 * own, so that comparison is what stops someone opening the edit form for
 * a listing they did not post.
 */
export async function vcForEdit(db: Db, id: string) {
  return maybeRow("vcs_grants (for edit)", () =>
    db
      .from("vcs_grants")
      .select("posted_by, status, kind, name, description, link, amount, deadline, stage")
      .eq("id", id)
      .single());
}
