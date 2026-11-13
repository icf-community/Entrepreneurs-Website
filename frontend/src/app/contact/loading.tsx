import AppShell from "@/components/app/AppShell";
import { FormSkeleton, PageHeaderSkeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1).
export default function Loading() {
  return (
    <AppShell active="settings">
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[640px]">
          <PageHeaderSkeleton />
          <div className="mt-8">
            <FormSkeleton fields={4} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
