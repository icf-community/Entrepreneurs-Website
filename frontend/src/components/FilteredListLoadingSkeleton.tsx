import AppShell from "@/components/app/AppShell";
import type { NavKey } from "@/components/app/Sidebar";
import { Skeleton, FilterBarSkeleton, CardGridSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";

// Shared by every loading.tsx whose route is a title + filter bar + a grid
// or row list of cards (calendar, events, vcs, members, my-activity,
// opportunities, my-submissions, my-bookmarks) — see any one of those
// files for why a loading.tsx exists at all and why AppShell is rendered
// here too.
export function FilteredListLoadingSkeleton({
  active,
  body = "rows",
}: {
  active: NavKey;
  /** Which skeleton the real page below fills with: a card grid or a row list. */
  body?: "cards" | "rows";
}) {
  return (
    <AppShell active={active}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-8">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-[22rem] max-w-full mt-3" />
            <Skeleton className="h-3 w-32 mt-4" />
          </div>
          <FilterBarSkeleton />
          <div className="mt-8">
            {body === "cards" ? <CardGridSkeleton /> : <RowListSkeleton />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
