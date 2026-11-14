import { pageParam } from "@/lib/filters/serverParams";
import { adminReportsPage, REPORTS_PAGE_SIZE } from "@/lib/data/posts";
import ReportsClient from "./ReportsClient";
import { requireAdminPage } from "@/lib/auth/guard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { Page } from "@/components/ui/Page";

// ════════════════════════════════════════════════════════════════════
// Foundry · /admin/reports
//
// The other half of the report button. This page is not optional: a
// report that lands in a table nobody reads is worse than having no
// button at all, because it is a documented notification we demonstrably
// did not act on. If reporting exists, this queue has to exist with it.
//
// Offset paged, unlike /community. This is a filtered admin list where
// "12 open, page 2 of 3" is the useful framing and the reader wants a
// total — the same shape as the member directory admin, reusing Pager.
// ════════════════════════════════════════════════════════════════════

type SearchParams = { status?: string; page?: string };

const STATUSES = ["open", "actioned", "dismissed", "all"];

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  // react-doctor-disable-next-line server-sequential-independent-await -- cannot parallelize: requireAdminPage() must stay a literal separate await (adminPages.test.ts greps for it as a security invariant), and the third await depends on both preceding results
  const { supabase } = await requireAdminPage();

  // An unrecognised ?status= narrows to the default rather than being
  // handed to the RPC as if it were a status.
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "open";
  const page = pageParam(sp.page);

  const { reports, matching } = await adminReportsPage(supabase, { status, page });

  return (
    <Page as="main">
      <PageHead
        className="mb-8"
        context="Admin · reported posts"
        title="Reported posts"
        lede="Members report posts from the Community feed. Resolving a report emails the reporter with the outcome, whichever way it goes. Reports are kept for 12 months."
        actions={
          <ButtonLink href="/admin" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={18} />}>
            Admin home
          </ButtonLink>
        }
      />

      <ReportsClient
        reports={reports}
        status={status}
        page={page}
        matching={matching}
        pageSize={REPORTS_PAGE_SIZE}
      />
    </Page>
  );
}
