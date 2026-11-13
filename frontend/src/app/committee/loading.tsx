import AppShell from "@/components/app/AppShell";
import { PageHeaderSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Panel } from "@/components/ui/Panel";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page (a row of five tiles) so nothing jumps when
// it streams in (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="committee">
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHeaderSkeleton />
          <SkeletonRegion className="flex flex-wrap justify-center gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Panel key={i} className="grid w-[calc(50%-0.375rem)] justify-items-center gap-3 px-3 pb-5 pt-6 sm:w-[8.5rem]">
                <Skeleton shape="ring" className="size-24" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </Panel>
            ))}
          </SkeletonRegion>
        </div>
      </div>
    </AppShell>
  );
}
