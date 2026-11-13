import AppShell from "@/components/app/AppShell";
import { CardGridSkeleton, FilterBarSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1). The opening is PageHead's own shape, then the three
// line tabs on their hairline, then the search and filter bar and the cards.
export default function Loading() {
  return (
    <AppShell active="connections">
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHeaderSkeleton />
          <div className="mt-8 mb-6 flex items-center gap-6 border-b border-border">
            <Skeleton className="my-3.5 h-4 w-28" />
            <Skeleton className="my-3.5 h-4 w-20" />
            <Skeleton className="my-3.5 h-4 w-12" />
          </div>
          <FilterBarSkeleton />
          <CardGridSkeleton className="mt-8" count={6} />
        </div>
      </div>
    </AppShell>
  );
}
