import AppShell from "@/components/app/AppShell";
import { FormSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="settings">
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[640px] mx-auto space-y-6">
          <PageHeaderSkeleton />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-2xl bg-bg-card border border-border p-8">
              <Skeleton className="h-4 w-1/3 mb-6" />
              <FormSkeleton fields={2} />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
