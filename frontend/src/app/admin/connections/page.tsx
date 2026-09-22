import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  adminConnectionReportsPage,
  adminFlaggedSenders,
  adminConnectionStats,
  CONNECTION_REPORTS_PAGE_SIZE,
} from "@/lib/data/adminConnections";
import { getConnectionsStatus } from "../actions";
import ConnectionsAdminClient from "./ConnectionsAdminClient";

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
  const sp = await searchParams;
  const supabase = await createClient();

  // An unrecognised ?status= narrows to the default rather than being
  // handed to the RPC as if it were a status.
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "open";
  const parsedPage = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

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
          <p className="label-wide text-text-muted mt-6 mb-4">Admin · connections</p>
          <h1 className="font-display leading-[1.1] tracking-tight text-[clamp(1.75rem,3vw,2.5rem)]">
            Connections
          </h1>
          <p className="mt-3 max-w-[60ch] text-[0.875rem] text-text-secondary leading-relaxed">
            Members connect to exchange email addresses. Reports here are about a specific
            connection and the note that came with it — resolving one emails the reporter with
            the outcome, whichever way it goes.
          </p>
        </div>

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
