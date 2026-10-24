import Link from "next/link";
import { adminReportsPage, REPORTS_PAGE_SIZE } from "@/lib/data/posts";
import ReportsClient from "./ReportsClient";
import { requireAdminPage } from "@/lib/auth/guard";

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
  const parsedPage = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const { reports, matching } = await adminReportsPage(supabase, { status, page });

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-bg-primary text-text-primary px-8 py-12"
    >
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-8 rule-draw pt-6">
          <Link
            href="/admin"
            className="text-[0.8rem] text-text-secondary hover:text-text-primary"
          >
            ← Admin home
          </Link>
          <p className="label-wide text-text-muted mt-6 mb-4">Admin · reported posts</p>
          <h1 className="font-display leading-[1.1] tracking-tight text-[clamp(1.75rem,3vw,2.5rem)]">
            Reported posts
          </h1>
          <p className="mt-3 max-w-[60ch] text-[0.875rem] text-text-secondary leading-relaxed">
            Members report posts from the Community feed. Resolving a report emails the reporter
            with the outcome, whichever way it goes. Reports are kept for 12 months.
          </p>
        </div>

        <ReportsClient
          reports={reports}
          status={status}
          page={page}
          matching={matching}
          pageSize={REPORTS_PAGE_SIZE}
        />
      </div>
    </main>
  );
}
