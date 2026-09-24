import "server-only";
import { rows, type Db } from "./query";
import { cached } from "@/lib/cache";
import { signedImageUrls } from "@/lib/storage/blobRead";
import type { Affiliation } from "@/lib/intake/steps";

// ════════════════════════════════════════════════════════════════════
// Foundry · The member directory
//
// /community and /admin/members are the same read wearing two hats:
// filter members in Postgres, page them, and hand the client the facet
// lists its chips are built from. Between the two pages and their two
// client components the Facets shape was declared four times and the
// member shape twice each.
//
// The filter values arrive from the URL and go straight into RPC
// arguments. That is safe because they are arguments — the RPCs bind
// them, and admin_list_profiles' caller drops unrecognised roles and
// statuses before they get here — but it is the reason the argument
// building lives in one place rather than being retyped per page.
// ════════════════════════════════════════════════════════════════════

/** One screen of cards. */
export const DIRECTORY_PAGE_SIZE = 48;

/**
 * The facet lists behind the filter chips: every distinct course, sector
 * and skill in the membership, plus the graduation-year range.
 *
 * grad_min and grad_max are min()/max() over a nullable column, so they
 * are null for an empty membership — the generated Returns says `number`
 * because gen types cannot see that. Widened here, and the pages have
 * always treated them as nullable.
 */
export type Facets = {
  courses: string[];
  sectors: string[];
  skills: string[];
  grad_min: number | null;
  grad_max: number | null;
  total: number;
};

export const EMPTY_FACETS: Facets = {
  courses: [], sectors: [], skills: [], grad_min: null, grad_max: null, total: 0,
};

/** The filter state both directories parse out of the URL. */
export type MemberFilters = {
  q: string;
  roles: string[];
  courses: string[];
  sectors: string[];
  skills: string[];
  gradMin: string;
  gradMax: string;
  page: number;
};

/**
 * The filters, as RPC arguments.
 *
 * Empty means absent, not empty-array: the RPCs treat a null argument as
 * "no filter on this column", so passing `[]` would narrow to nothing.
 */
export function filterArgs(f: MemberFilters) {
  return {
    p_query:    f.q || undefined,
    p_roles:    f.roles.length ? f.roles : undefined,
    p_courses:  f.courses.length ? f.courses : undefined,
    p_sectors:  f.sectors.length ? f.sectors : undefined,
    p_skills:   f.skills.length ? f.skills : undefined,
    p_grad_min: f.gradMin ? Number.parseInt(f.gradMin, 10) : undefined,
    p_grad_max: f.gradMax ? Number.parseInt(f.gradMax, 10) : undefined,
  };
}

// ────────────────────────────────────────────────────────────────────
// Facets
// ────────────────────────────────────────────────────────────────────

/**
 * The public directory's facets, cached.
 *
 * Identical for every member and a couple of hundred bytes, unlike the
 * result pages. Skipped for admins, who see counts the cache must not
 * hold, and never cached while empty — an empty facet set is what a
 * failed read looks like, and caching that would pin the filter bar
 * shut until the TTL expired.
 */
export async function directoryFacets(db: Db, { skip }: { skip: boolean }): Promise<Facets> {
  return cached(
    "directoryFacets",
    async () => {
      const data = await rows("list_directory_facets", () => db.rpc("list_directory_facets"));
      return data[0] ?? EMPTY_FACETS;
    },
    { skip, isCacheable: (f) => f.total > 0 },
  );
}

/** The admin facets: same shape, no cache — admin reads see every status. */
export async function adminFacets(db: Db): Promise<Facets> {
  const data = await rows("admin_profile_facets", () => db.rpc("admin_profile_facets"));
  return data[0] ?? EMPTY_FACETS;
}

// ────────────────────────────────────────────────────────────────────
// The public directory
// ────────────────────────────────────────────────────────────────────

// bio_focus and bio_hobbies are previews truncated by the RPC, not the
// full text — the dialog reads those directly when it opens. course,
// grad_year and the two preview columns are nullable in the table and
// non-null in the generated Returns, so they are widened back here.
//
// Renamed from bio/working_on (20260901000007) when the rebuilt intake's
// columns replaced them: bio_focus is "what you're working on, or into"
// and bio_hobbies is genuinely new, with no legacy equivalent.
type CardRow = {
  id: string;
  first_name: string;
  surname: string;
  role: Affiliation;
  course: string | null;
  grad_year: number | null;
  avatar_path: string | null;
  bio_focus: string | null;
  bio_hobbies: string | null;
  created_at: string;
  skill_names: string[] | null;
  sector_names: string[] | null;
  total_count: number;
};

export function toDirectoryMember(r: CardRow, lookingFor: { id: string; role: string }[]) {
  return {
    id: r.id,
    firstName: r.first_name,
    surname: r.surname,
    role: r.role,
    course: r.course,
    gradYear: r.grad_year,
    avatarPath: r.avatar_path,
    bioPreview: r.bio_focus,
    hobbiesPreview: r.bio_hobbies,
    skills:  r.skill_names  ?? [],
    sectors: r.sector_names ?? [],
    lookingFor,
  };
}

type DirectoryMemberBase = ReturnType<typeof toDirectoryMember>;

export type DirectoryMember = DirectoryMemberBase & { avatarUrl: string | null };

/**
 * Mints a read URL for every member with an avatar, one signing round
 * rather than one per card. Members without a photo get `avatarUrl: null`
 * directly — no point asking the signer for a key it doesn't have.
 */
export async function withAvatarUrls<T extends DirectoryMemberBase>(
  members: T[],
): Promise<(T & { avatarUrl: string | null })[]> {
  const withPath = members
    .map((m, i) => ({ i, path: m.avatarPath }))
    .filter((x): x is { i: number; path: string } => x.path != null);

  const urls = withPath.length
    ? await signedImageUrls(withPath.map((x) => x.path), "profile_picture")
    : [];
  const urlByIndex = new Map(withPath.map((x, j) => [x.i, urls[j] ?? null]));

  return members.map((m, i) => ({ ...m, avatarUrl: urlByIndex.get(i) ?? null }));
}

export type DirectoryPage = {
  members: DirectoryMember[];
  facets: Facets;
  /** Members matching the current filters, not members overall. */
  matching: number;
};

/**
 * The roles each member on screen is hiring for, by poster id.
 *
 * Scoped to the ids actually being rendered rather than every approved
 * opportunity: that query was unbounded, and it exists to decorate at
 * most 53 cards.
 */
async function openRolesByPoster(db: Db, ids: string[]) {
  const byUser = new Map<string, { id: string; role: string }[]>();
  if (ids.length === 0) return byUser;

  const data = await rows("opportunities (open roles)", () =>
    db
      .from("opportunities")
      .select("id, posted_by, position_name")
      .eq("status", "approved")
      .in("posted_by", ids));

  for (const r of data) {
    const list = byUser.get(r.posted_by) ?? [];
    list.push({ id: r.id, role: r.position_name });
    byUser.set(r.posted_by, list);
  }
  return byUser;
}

/**
 * The most recently joined members, ignoring every filter.
 *
 * Was the `newest` field on directoryPage, and moved out when the strip
 * did: /home renders it now and /members does not, so making the
 * directory pay for a second RPC on every filter keystroke would be
 * paying for a query nothing reads.
 */
export async function newestMembers(
  db: Db,
  limit = 5,
  { isAdmin = false }: { isAdmin?: boolean } = {},
): Promise<DirectoryMember[]> {
  // Cached for /home's five only; the key does not carry the limit.
  // Raw rows are what's cached — avatar URLs are signed per request below.
  const cards = await cached(
    "directoryNewest",
    () => rows("list_directory_cards (newest)", () =>
      db.rpc("list_directory_cards", { p_limit: limit, p_sort: "recent" })),
    { skip: isAdmin || limit !== 5, isCacheable: (r) => r.length > 0 },
  );
  const lookingFor = await openRolesByPoster(db, cards.map((r) => r.id));
  return withAvatarUrls(cards.map((r) => toDirectoryMember(r, lookingFor.get(r.id) ?? [])));
}

/**
 * One page of the member directory, plus the facets.
 *
 * Filtering and paging happen in Postgres. They have to: the client used
 * to derive its chips and its search from the full member array, which
 * stopped being possible the moment it holds only one page — and holding
 * the full array is what PostgREST's 1000-row cap silently truncated.
 * See migration 20260826000003.
 */
export async function directoryPage(
  db: Db,
  filters: MemberFilters,
  { isAdmin }: { isAdmin: boolean },
): Promise<DirectoryPage> {
  // Only the unfiltered first page is cached (see cache.ts). Anything
  // with a search, a filter or a later page goes straight to Postgres.
  const unfiltered =
    filters.page === 1 && !filters.q &&
    !filters.roles.length && !filters.courses.length &&
    !filters.sectors.length && !filters.skills.length &&
    !filters.gradMin && !filters.gradMax;
  const [cards, facets] = await Promise.all([
    cached(
      "directoryFirstPage",
      () => rows("list_directory_cards", () =>
        db.rpc("list_directory_cards", {
          ...filterArgs(filters),
          p_limit:  DIRECTORY_PAGE_SIZE,
          p_offset: (filters.page - 1) * DIRECTORY_PAGE_SIZE,
          p_sort:   "name",
        })),
      { skip: isAdmin || !unfiltered, isCacheable: (r) => r.length > 0 },
    ),
    directoryFacets(db, { skip: isAdmin }),
  ]);

  const lookingFor = await openRolesByPoster(db, cards.map((r) => r.id));

  return {
    members: await withAvatarUrls(cards.map((r) => toDirectoryMember(r, lookingFor.get(r.id) ?? []))),
    facets,
    // total_count rides on every row via a window function, so it is
    // absent exactly when the page is empty.
    matching: cards[0]?.total_count ?? 0,
  };
}
