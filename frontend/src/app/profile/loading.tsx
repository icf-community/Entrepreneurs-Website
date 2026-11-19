import AppShell from "@/components/app/AppShell";
import { Panel } from "@/components/ui/Panel";
import { FormSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";

// Same reasoning as members/loading.tsx. Drawn as the page is: the head, then
// rows with the title and its sentence at the side and the fields beside them.
export default function Loading() {
  return (
    <AppShell active="settings">
      <Page>
        <PageHeaderSkeleton />
        <div className="mt-8">
          <div className="grid gap-x-12 gap-y-6 border-t border-border-subtle py-9 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <div className="grid content-start gap-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-3 w-full" />
            </div>
            <Panel className="flex max-w-[34rem] items-center gap-4 p-5">
              <Skeleton shape="ring" className="size-16 shrink-0" />
              <Skeleton className="h-4 w-1/3" />
            </Panel>
          </div>
          <div className="grid gap-x-12 gap-y-6 border-t border-border-subtle py-9 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <div className="grid content-start gap-3">
              <Skeleton className="h-6 w-1/4" />
            </div>
            <FormSkeleton fields={4} className="max-w-[34rem]" />
          </div>
        </div>
      </Page>
    </AppShell>
  );
}
