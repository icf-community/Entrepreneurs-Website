import AppShell from "@/components/app/AppShell";
import { FormSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1). Three rows, each drawn as a settings row is: the
// title and its sentence at the side, the fields beside them.
export default function Loading() {
  return (
    <AppShell active="settings">
      <Page>
        <PageHeaderSkeleton />
        <div className="mt-8">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="grid gap-x-12 gap-y-6 border-t border-border-subtle py-9 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]"
            >
              <div className="grid content-start gap-3">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <FormSkeleton fields={2} className="max-w-[34rem]" />
            </div>
          ))}
        </div>
      </Page>
    </AppShell>
  );
}
