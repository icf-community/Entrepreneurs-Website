import AppShell from "@/components/app/AppShell";
import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="committee">
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[1200px] mx-auto">
          <PageHeaderSkeleton />
          <CardGridSkeleton count={6} />
        </div>
      </div>
    </AppShell>
  );
}
