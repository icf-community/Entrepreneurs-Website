import { Suspense } from "react";
import Link from "next/link";
import { Skeleton, FilterBarSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import {
  adminMemberPage,
  ADMIN_MEMBERS_PAGE_SIZE,
  type AdminMemberFilters,
  type AdminMemberPage,
} from "@/lib/data/admin";
import MembersAdminClient from "./MembersAdminClient";
import { requireAdminPage } from "@/lib/auth/guard";
import { flattenSearchParams, pageParam, yearParam } from "@/lib/filters/serverParams";

type SearchParams = {
  q?: string; role?: string; status?: string; course?: string;
  sector?: string; skill?: string; gradMin?: string; gradMax?: string; page?: string;
};

const MULTI_PARAMS = ["role", "status", "course", "sector", "skill"] as const;
const ROLES: string[] = ["student", "alum"];
const STATUSES: string[] = ["pending_onboarding", "pending_review", "approved", "rejected"];

const list = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function parseFilters(sp: SearchParams): AdminMemberFilters {
  return {
    q: sp.q ?? "",
    // Dropping unknown values rather than passing them through: ?role=nonsense
    // is a reachable URL, and an unrecognised value must narrow to nothing
    // rather than be handed to the query as if it were a role.
    roles: list(sp.role).filter((r) => ROLES.includes(r)),
    statuses: list(sp.status).filter((s) => STATUSES.includes(s)),
    courses: list(sp.course),
    sectors: list(sp.sector),
    skills: list(sp.skill),
    gradMin: yearParam(sp.gradMin),
    gradMax: yearParam(sp.gradMax),
    page: pageParam(sp.page),
  };
}

export default async function AdminCommunityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { supabase } = await requireAdminPage();
  // A repeated param arrives as an array; flatten before anything .split()s it.
  const filters = parseFilters(flattenSearchParams(await searchParams, MULTI_PARAMS));

  // Started, not awaited: the header renders while the query is in flight.
  const data = adminMemberPage(supabase, filters);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin · member directory</p>
            <h1 className="font-display text-display leading-[1.1] tracking-tight">
              All members
            </h1>
            {/* div, not p: the skeleton is a div, and a div inside a p
                breaks hydration (see ListingPageShell). */}
            <div className="text-body text-text-muted mt-2">
              <Suspense fallback={<Skeleton className="h-3 w-16 inline-block align-middle" />}>
                <MemberTotal data={data} />
              </Suspense>{" "}
              Filter by role, status, course, year, interests, or skills. Deletion is permanent and notifies the user by email.
            </div>
          </div>
          <Link
            href="/admin"
            className="text-body text-text-secondary no-underline transition-colors duration-150 hover:text-text-primary"
          >
            ← Admin home
          </Link>
        </div>

        <Suspense
          fallback={
            <>
              <FilterBarSkeleton />
              <TableSkeleton className="mt-8" rows={10} />
            </>
          }
        >
          <MemberTable data={data} filters={filters} />
        </Suspense>
      </div>
    </main>
  );
}

async function MemberTotal({ data }: { data: Promise<AdminMemberPage> }) {
  const { facets } = await data;
  return <>{facets.total} total.</>;
}

async function MemberTable({
  data, filters,
}: {
  data: Promise<AdminMemberPage>;
  filters: AdminMemberFilters;
}) {
  const { members, facets, matching } = await data;
  return (
    <MembersAdminClient
      members={members}
      facets={facets}
      filters={filters}
      matching={matching}
      pageSize={ADMIN_MEMBERS_PAGE_SIZE}
    />
  );
}
