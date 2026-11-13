import AppShell from "@/components/app/AppShell";
import { PageHeaderSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";

// See events/loading.tsx for why this exists and renders the shell.
export default function Loading() {
  return (
    <AppShell active="activity">
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[44rem]">
          <PageHeaderSkeleton />
          <RowListSkeleton />
        </div>
      </div>
    </AppShell>
  );
}
