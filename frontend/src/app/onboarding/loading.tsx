import { PublicHeader } from "@/app/login/PublicHeader";
import { Page } from "@/components/ui/Page";
import { Panel } from "@/components/ui/Panel";
import { FormSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1): the same header, the masthead, the progress line and
// the one card with its two fields and its button.
// Onboarding has no app shell (the member isn't approved yet).
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader sticky>
        <Skeleton className="h-4 w-40" />
      </PublicHeader>

      <main id="main-content" tabIndex={-1} className="flex-1">
        <Page width="narrow" align="center">
          <PageHeaderSkeleton />
          <Skeleton className="my-7 h-0.5 w-full" />
          <Panel className="grid gap-6 p-6 sm:p-8">
            <FormSkeleton fields={2} />
            <Skeleton className="ml-auto h-[58px] w-40 rounded-full" />
          </Panel>
        </Page>
      </main>
    </div>
  );
}
