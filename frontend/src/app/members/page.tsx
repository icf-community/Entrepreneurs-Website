import { Suspense } from "react";
import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { FilterBarSkeleton, CardGridSkeleton } from "@/components/ui/Skeleton";
import { PageHead } from "@/components/ui/PageHead";
import {
  directoryPage,
  DIRECTORY_PAGE_SIZE,
  type DirectoryPage,
  type MemberFilters,
} from "@/lib/data/directory";
import { aiModeEnabled } from "@/lib/ai/data";
import MembersClient from "./MembersClient";
import { flattenSearchParams, pageParam, yearParam } from "@/lib/filters/serverParams";

type SearchParams = {
  q?: string; role?: string; course?: string; sector?: string;
  skill?: string; gradMin?: string; gradMax?: string; page?: string;
};

const MULTI_PARAMS = ["role", "course", "sector", "skill"] as const;

// Multi-value filters travel as comma-separated params so a filtered view
// is a URL you can send someone.
const list = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function parseFilters(sp: SearchParams): MemberFilters {
  return {
    q: sp.q ?? "",
    roles: list(sp.role).filter((r) => r === "student" || r === "alum"),
    courses: list(sp.course),
    sectors: list(sp.sector),
    skills: list(sp.skill),
    gradMin: yearParam(sp.gradMin),
    gradMax: yearParam(sp.gradMax),
    page: pageParam(sp.page),
  };
}

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();
  // A repeated param arrives as an array; flatten before anything .split()s it.
  const filters = parseFilters(flattenSearchParams(await searchParams, MULTI_PARAMS));

  // Started, not awaited — see the note in app/vcs/page.tsx.
  const data = directoryPage(supabase, filters, { isAdmin });
  const aiEnabled = aiModeEnabled(supabase, "network");

  return (
    <AppShell active="members" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[var(--content-max)]">
          {/* The eyebrow label became the masthead's context line; the title and its rule are PageHead's. */}
          <PageHead context="Members" title="The Foundry directory" className="mb-8" />
          <Suspense
            fallback={
              <>
                <FilterBarSkeleton />
                <CardGridSkeleton className="mt-8" count={9} />
              </>
            }
          >
            <Directory data={data} filters={filters} aiEnabled={aiEnabled} />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}

async function Directory({
  data, filters, aiEnabled,
}: {
  data: Promise<DirectoryPage>;
  filters: MemberFilters;
  aiEnabled: Promise<boolean>;
}) {
  const [{ members, facets, matching }, enabled] = await Promise.all([data, aiEnabled]);
  return (
    <MembersClient
      members={members}
      facets={facets}
      filters={filters}
      matching={matching}
      pageSize={DIRECTORY_PAGE_SIZE}
      aiEnabled={enabled}
    />
  );
}
