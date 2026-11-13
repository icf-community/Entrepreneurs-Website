import AppShell from "@/components/app/AppShell";
import { CardGridSkeleton, FilterBarSkeleton, PageHeaderSkeleton } from "@/components/ui/Skeleton";

// See events/loading.tsx for why this exists and renders the shell. Drawn to the
// page's own column (the gutter and the content width), so nothing shifts when
// the directory streams in.
export default function Loading() {
  return (
    <AppShell active="members">
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHeaderSkeleton />
          <FilterBarSkeleton />
          <CardGridSkeleton className="mt-8" count={9} />
        </div>
      </div>
    </AppShell>
  );
}
