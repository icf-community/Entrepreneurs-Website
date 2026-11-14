import AppShell from "@/components/app/AppShell";
import { Panel } from "@/components/ui/Panel";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";

// Same reasoning as members/loading.tsx: painted instantly on navigation,
// swapped for the real page once its four concurrent queries (newest
// members, events, opportunities, VCs) have resolved. Mirrors the real
// page's own skeletons (a row of five ring tiles, the events with the newest
// given the room, two lists of rows) in the page's own column, so there is no
// visible shift in proportions when the real content streams in.

/** A section's title and its one line. */
function HeadSkeleton({ title, line }: { title: string; line: string }) {
  return (
    <div className="grid gap-2">
      <Skeleton className={`h-6 ${title}`} />
      <Skeleton className={`h-3 max-w-full ${line}`} />
    </div>
  );
}

/** A person's or a listing's name and the line under it. */
function NameLines() {
  return (
    <>
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-3 w-2/5" />
    </>
  );
}

/** A list of rows in a panel: a ring, a name and a line. */
function RowsSkeleton() {
  return (
    <Panel className="grid gap-1 p-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton shape="ring" className="size-11 shrink-0" />
          <div className="grid flex-1 gap-2.5">
            <NameLines />
          </div>
        </div>
      ))}
    </Panel>
  );
}

export default function Loading() {
  return (
    <AppShell active="home">
      <Page>
        <div className="lm-skel-head mb-8">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="lm-skel--title w-48 max-w-full" />
        </div>

        <SkeletonRegion className="lm-sections">
          <div className="grid gap-5">
            <Skeleton className="h-7 w-72 max-w-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Panel key={i} className="grid justify-items-center gap-3 px-3 pb-5 pt-6">
                  <Skeleton shape="ring" className="size-24" />
                  <NameLines />
                </Panel>
              ))}
            </div>
          </div>

          <div className="grid gap-5">
            <HeadSkeleton title="w-32" line="w-64" />
            <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Skeleton className="h-48 w-full rounded-xl lg:row-span-2 lg:h-full" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          </div>

          <div className="grid gap-[var(--section-gap)] lg:grid-cols-2 lg:gap-x-10">
            <div className="grid gap-5">
              <HeadSkeleton title="w-40" line="w-56" />
              <RowsSkeleton />
            </div>
            <div className="grid gap-5">
              <HeadSkeleton title="w-36" line="w-56" />
              <RowsSkeleton />
            </div>
          </div>
        </SkeletonRegion>
      </Page>
    </AppShell>
  );
}
