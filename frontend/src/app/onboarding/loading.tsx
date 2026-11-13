import { BrandLogo } from "@/components/BrandLogo";
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
      <header className="z-40 border-b border-border-subtle bg-bg-primary/85 px-[var(--gutter)] backdrop-blur-md sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[var(--content-max)] flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
          <div className="max-[430px]:[&_.font-display]:hidden">
            <BrandLogo size="sm" />
          </div>
          <Skeleton className="h-4 w-40" />
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 px-[var(--gutter)] pb-20 pt-4">
        <div className="mx-auto w-full max-w-[640px]">
          <PageHeaderSkeleton />
          <Skeleton className="my-7 h-0.5 w-full" />
          <Panel className="grid gap-6 p-6 sm:p-8">
            <FormSkeleton fields={2} />
            <Skeleton className="ml-auto h-[58px] w-40 rounded-full" />
          </Panel>
        </div>
      </main>
    </div>
  );
}
