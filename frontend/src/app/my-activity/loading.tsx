import AppShell from "@/components/app/AppShell";
import { PageHeaderSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";

// See events/loading.tsx for why this exists and renders the shell.
export default function Loading() {
  return (
    <AppShell active="activity">
      <Page width="page">
        <PageHeaderSkeleton />
        <RowListSkeleton />
      </Page>
    </AppShell>
  );
}
