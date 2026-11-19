import AppShell from "@/components/app/AppShell";
import { CardGridSkeleton, FilterBarSkeleton, PageHeaderSkeleton } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";

// See events/loading.tsx for why this exists and renders the shell. Drawn to the
// page's own column (the gutter and the content width), so nothing shifts when
// the directory streams in.
export default function Loading() {
  return (
    <AppShell active="members">
      <Page>
        <PageHeaderSkeleton />
        <FilterBarSkeleton />
        <CardGridSkeleton className="mt-8" count={9} />
      </Page>
    </AppShell>
  );
}
