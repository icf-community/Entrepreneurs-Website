import { BrandLogo } from "@/components/BrandLogo";
import { Panel } from "@/components/ui/Panel";
import { PageHeaderSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx: painted instantly on navigation,
// swapped for the real IntakeFlow once its data (taxonomy, sectors, the
// "You're in" matches) has loaded. Mirrors IntakeFlow's own shell rather
// than AppShell's, since the real page doesn't use AppShell either — and
// carries the same #main-content id/tabIndex the real page's <main> does,
// so the skip link isn't left pointing at nothing while this is on screen.
// Drawn to the real page's size: the header, the rail's three groups, the
// masthead, the progress line and the card with its first fields.

/** One group of the rail: its title, its note and its rows (a StepDots row is 44 px). */
function RailGroup({ rows }: { rows: number }) {
  return (
    <div className="mb-8 last:mb-0">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mb-3 mt-2.5 h-3 w-48" />
      <div className="grid gap-0.5">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="z-40 border-b border-border-subtle bg-bg-primary/85 px-[var(--gutter)] backdrop-blur-md sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[var(--content-max)] flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
          <div>
            <BrandLogo size="sm" />
          </div>
          <Skeleton className="h-11 w-32 rounded-full" />
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-[var(--gutter)] pb-24 pt-6 lg:pt-10"
      >
        <SkeletonRegion className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
          <div className="hidden pt-[28px] lg:block">
            <RailGroup rows={2} />
            <RailGroup rows={4} />
            <RailGroup rows={2} />
          </div>

          <div className="min-w-0 max-w-[44rem]">
            <PageHeaderSkeleton />
            <Skeleton className="my-7 h-0.5 w-full" />
            <Panel className="grid gap-6 p-6 sm:p-8">
              <Skeleton className="h-4 w-full max-w-[34rem]" />
              <div>
                <Skeleton className="mb-3 h-3 w-1/4" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
              <div>
                <Skeleton className="mb-3 h-3 w-1/3" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
            </Panel>
          </div>
        </SkeletonRegion>
      </main>
    </div>
  );
}
