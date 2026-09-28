import AppShell from "@/components/app/AppShell";
import { PageHeaderSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="notifications">
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[760px] mx-auto">
          <PageHeaderSkeleton />
          <RowListSkeleton count={6} />
        </div>
      </div>
    </AppShell>
  );
}
