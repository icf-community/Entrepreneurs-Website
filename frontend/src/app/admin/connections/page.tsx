import { pageParam } from "@/lib/filters/serverParams";
import {
  adminConnectionReportsPage,
  adminFlaggedSenders,
  adminConnectionStats,
  CONNECTION_REPORTS_PAGE_SIZE,
} from "@/lib/data/adminConnections";
import { getConnectionsStatus } from "../actions";
import ConnectionsAdminClient from "./ConnectionsAdminClient";
import { requireAdminPage } from "@/lib/auth/guard";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

// ════════════════════════════════════════════════════════════════════
// Foundry · /admin/connections
//
// Four surfaces on one page, because they are read together: a flagged
// sender is only interpretable next to the reports that flagged them, and
// the kill switch is the thing you reach for after reading both.
//
// WHAT IS DELIBERATELY NOT HERE: a view of the whole network. Connections
// buy an email address the other party individually agreed to share — not
// reach, ranking or status — so a collusion ring gains nothing, and closed
// verified membership makes building one expensive for no payoff. A
// standing UI rendering everyone's relationships would be the largest
// personal-data read in the app, permanently, needing to be secured,
// audited and defended in the DPIA whether or not anyone ever opened it.
//
// What replaces it is the three aggregates below: total, median per
// member, cross-cohort percentage. They answer the community-health
// question ("are cohorts siloed?") with no per-member exposure at all.
// Anything deeper is an ad-hoc SQL query against a table that already
// holds the data.
// ════════════════════════════════════════════════════════════════════

type SearchParams = { status?: string; page?: string };

const STATUSES = ["open", "actioned", "dismissed", "all"];

export default async function AdminConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { supabase } = await requireAdminPage();
  const sp = await searchParams;

  // An unrecognised ?status= narrows to the default rather than being
  // handed to the RPC as if it were a status.
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "open";
  const page = pageParam(sp.page);

  const [{ reports, matching }, senders, stats, connectionsStatus] = await Promise.all([
    adminConnectionReportsPage(supabase, { status, page }),
    adminFlaggedSenders(supabase),
    adminConnectionStats(supabase),
    getConnectionsStatus(),
  ]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen px-[var(--gutter)] pb-24 pt-10 text-text-primary"
    >
      <div className="mx-auto max-w-[var(--content-max)]">
        <AdminPageHeader
          eyebrow="Admin · connections"
          title="Connections"
          description="Members connect to exchange email addresses. Reports here are about a specific connection and the note that came with it — resolving one emails the reporter with the outcome, whichever way it goes."
        />

        <ConnectionsAdminClient
          reports={reports}
          status={status}
          page={page}
          matching={matching}
          pageSize={CONNECTION_REPORTS_PAGE_SIZE}
          senders={senders}
          stats={stats}
          connectionsStatus={
            connectionsStatus.ok
              ? connectionsStatus.data
              : { enabled: true, lastChangedAt: null, lastChangedBy: null }
          }
        />
      </div>
    </main>
  );
}
