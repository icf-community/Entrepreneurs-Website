import AppShell from "@/components/app/AppShell";
import { Skeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx.
export default function Loading() {
  return (
    <AppShell active="settings">
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[640px] mx-auto">
          <Skeleton className="h-3 w-20 mb-6" />
          <div className="mb-10 pt-6">
            <Skeleton className="h-3 w-24 mb-3" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-3 w-full max-w-[30rem] mt-4" />
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-4 rounded-lg border border-border-strong bg-tint-1 p-4">
              <Skeleton className="h-16 w-16 rounded-full shrink-0" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-1/4 mb-2" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
