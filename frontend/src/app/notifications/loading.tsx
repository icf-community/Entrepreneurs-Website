import AppShell from "@/components/app/AppShell";
import { PageHeaderSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="notifications">
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[44rem]">
          <PageHeaderSkeleton />
          <RowListSkeleton count={6} />
        </div>
      </div>
    </AppShell>
  );
}
