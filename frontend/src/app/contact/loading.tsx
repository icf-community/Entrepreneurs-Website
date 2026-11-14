import AppShell from "@/components/app/AppShell";
import { FormSkeleton, PageHeaderSkeleton } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="settings">
      <Page width="narrow">
        <PageHeaderSkeleton />
        <div className="mt-8">
          <FormSkeleton fields={4} />
        </div>
      </Page>
    </AppShell>
  );
}
