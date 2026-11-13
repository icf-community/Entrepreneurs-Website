import AppShell from "@/components/app/AppShell";
import type { NavKey } from "@/components/app/Sidebar";
import { FilterBarSkeleton, CardGridSkeleton, RowListSkeleton, PageHeaderSkeleton } from "@/components/ui/Skeleton";

// Shared by every loading.tsx whose route is a title + filter bar + a grid
// or row list of cards (calendar, events, vcs, members, my-activity,
// opportunities, my-submissions, my-bookmarks) — see any one of those
// files for why a loading.tsx exists at all and why AppShell is rendered
// here too.
//
// The opening is PageHeaderSkeleton (the same rule, context line, title and lede
// PageHead draws), so the page does not jump when the real one streams in. The
// container classes below are the system's rhythm (--gutter at the sides,
// --content-max for the column) that the list pages use; if the pages change
// theirs, change them here too.
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
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHeaderSkeleton />
          <FilterBarSkeleton />
          <div className="mt-8">
            {body === "cards" ? <CardGridSkeleton /> : <RowListSkeleton />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
