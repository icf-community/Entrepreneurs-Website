import AppShell from "@/components/app/AppShell";
import { PageHeaderSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";

// Every other listing page (members, calendar, events, opportunities, vcs,
// profile) has one of these; /community was the one blocking async server
// component with no Suspense boundary, so a slow feed fetch showed a blank
// page instead of a shell. Same pattern as members/loading.tsx — see its
// own comment for why the shell, and the <main> id/tabIndex, matter here.
//
// The opening is PageHeaderSkeleton (the rule, context line, title and lede
// PageHead draws) in the page's own column, so nothing jumps when the real
// page streams in.
export default function Loading() {
  return (
    <AppShell active="community">
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[720px]">
          <PageHeaderSkeleton />
          <RowListSkeleton count={4} />
        </div>
      </div>
    </AppShell>
  );
}
