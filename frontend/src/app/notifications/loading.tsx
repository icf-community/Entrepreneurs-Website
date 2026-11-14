import AppShell from "@/components/app/AppShell";
import { PageHeaderSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";

// Same reasoning as members/loading.tsx (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="notifications">
      <Page width="page">
        <PageHeaderSkeleton />
        <RowListSkeleton count={6} />
      </Page>
    </AppShell>
  );
}
