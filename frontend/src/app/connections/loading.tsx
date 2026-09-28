import AppShell from "@/components/app/AppShell";
import { FilterBarSkeleton, PageHeaderSkeleton, RowListSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="connections">
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[1200px] mx-auto">
          <PageHeaderSkeleton />
          <div className="flex gap-2 mb-6">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-20 rounded-lg" />
          </div>
          <FilterBarSkeleton />
          <RowListSkeleton className="mt-8" count={6} />
        </div>
      </div>
    </AppShell>
  );
}
