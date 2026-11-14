import AppShell from "@/components/app/AppShell";
import { PageHeaderSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";

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
      <Page width="page">
        <PageHeaderSkeleton />
        <RowListSkeleton count={4} />
      </Page>
    </AppShell>
  );
}
