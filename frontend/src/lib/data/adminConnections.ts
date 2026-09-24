import { rows, type Db } from "@/lib/data/query";

// ════════════════════════════════════════════════════════════════════
// Foundry · Admin reads for Connections
//
// Three surfaces, and the one thing they have in common is what they do
// NOT return: no email addresses, and no note text.
//
// The note is private member-to-member content. `has_note` tells the
// queue whether there is anything to read; reading it is a separate,
// audited action (`admin_reveal_connection_note`) that writes an
// `admin_actions` row BEFORE the text is returned. A column on this list
// would make that audit meaningless — every admin who opened the queue
// would have read every note.
//
// Offset paged, same as /admin/reports: this is a filtered admin list
// where "12 open, page 2 of 3" is the useful framing and the reader wants
// a total.
// ════════════════════════════════════════════════════════════════════

export const CONNECTION_REPORTS_PAGE_SIZE = 50;

export type ConnectionReport = {
  id: string;
  connectionId: string;
  category: string;
  reason: string;
  status: "open" | "actioned" | "dismissed";
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** Whether a note was snapshotted at report time. Never the text itself. */
  hasNote: boolean;
  reporterId: string;
  reporterName: string;
  reportedMemberId: string;
  reportedName: string;
  /** Distinct members who blocked or successfully reported this sender in the throttle window. */
  reportedSignals: number;
  /** The reading admin is the reporter or the reported member. */
  adminIsParty: boolean;
};

export async function adminConnectionReportsPage(
  db: Db,
  filters: { status: string; page: number },
): Promise<{ reports: ConnectionReport[]; matching: number }> {
  const data = await rows("admin_list_connection_reports", () =>
    db.rpc("admin_list_connection_reports", {
      p_status: filters.status,
      p_limit: CONNECTION_REPORTS_PAGE_SIZE,
      p_offset: (filters.page - 1) * CONNECTION_REPORTS_PAGE_SIZE,
    }),
  );

  const reports: ConnectionReport[] = data.map((r) => ({
    id: r.id,
    connectionId: r.connection_id,
    category: r.category,
    reason: r.reason,
    status: r.status as ConnectionReport["status"],
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolutionNote: r.resolution_note,
    hasNote: Boolean(r.has_note),
    reporterId: r.reporter_id,
    reporterName: r.reporter_name,
    reportedMemberId: r.reported_member_id,
    reportedName: r.reported_name,
    reportedSignals: Number(r.reported_signals ?? 0),
    adminIsParty: Boolean(r.admin_is_party),
  }));

  return { reports, matching: Number(data[0]?.total_count ?? 0) };
}

export type FlaggedSender = {
  memberId: string;
  memberName: string;
  distinctSignals: number;
  /** Currently over the distinct-signal threshold, so their daily cap is reduced. */
  throttled: boolean;
  requestsSent: number;
  declines: number;
  declineRate: number;
};

export async function adminFlaggedSenders(db: Db): Promise<FlaggedSender[]> {
  const data = await rows("admin_list_flagged_senders", () =>
    db.rpc("admin_list_flagged_senders", { p_limit: 50 }),
  );

  return data.map((r) => ({
    memberId: r.member_id,
    memberName: r.member_name,
    distinctSignals: Number(r.distinct_signals ?? 0),
    throttled: Boolean(r.throttled),
    requestsSent: Number(r.requests_sent ?? 0),
    declines: Number(r.declines ?? 0),
    declineRate: Number(r.decline_rate ?? 0),
  }));
}

export type ConnectionStats = {
  totalConnections: number;
  medianPerMember: number;
  crossCohortPct: number;
};

/**
 * The three aggregates kept in place of the whole-network admin view that
 * was considered and rejected. Pure aggregates with no per-member
 * exposure: they answer "are cohorts siloed?" without a surface that can
 * show who knows whom.
 */
export async function adminConnectionStats(db: Db): Promise<ConnectionStats | null> {
  const data = await rows("admin_connection_stats", () => db.rpc("admin_connection_stats"));
  const r = data[0];
  if (!r) return null;
  return {
    totalConnections: Number(r.total_connections ?? 0),
    medianPerMember: Number(r.median_per_member ?? 0),
    crossCohortPct: Number(r.cross_cohort_pct ?? 0),
  };
}
