import { Suspense } from "react";
import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { FilterBarSkeleton, CardGridSkeleton } from "@/components/ui/Skeleton";
import type { MemberFilters } from "@/lib/data/directory";
import {
  myConnectionsPage,
  myPendingRequestsPage,
  mySentRequestsPage,
  myConnectionFacets,
  myConnectionGraph,
  consentVersion,
  decodeCursor,
  type ConnectionsPage,
  type RequestsPage,
  type PendingRequest,
  type SentRequest,
  type ConnectionGraph,
} from "@/lib/data/connections";
import ConnectionsClient, { type Tab, type View } from "./ConnectionsClient";

// ════════════════════════════════════════════════════════════════════
// Foundry · /connections
//
// Three tabs, and the tab is IN THE URL. That is not tidiness: the daily
// digest links straight at ?tab=pending, and dropping somebody on a
// default view when the mail was about their requests is the lesson the
// listing pages already learned with their deep links.
//
// Only the active tab's data is fetched. Three RPCs to render one list
// would put two of them on every page load for nothing, and the counts
// that matter — the pending badge — come from one cheap index-only scan
// that the shell already runs.
// ════════════════════════════════════════════════════════════════════

type SearchParams = {
  tab?: string; view?: string;
  q?: string; role?: string; course?: string; sector?: string;
  skill?: string; gradMin?: string; gradMax?: string;
  cursor?: string;
};

const TABS: Tab[] = ["connections", "pending", "sent"];

const list = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function parseFilters(sp: SearchParams): MemberFilters {
  return {
    q: sp.q ?? "",
    roles: list(sp.role),
    courses: list(sp.course),
    sectors: list(sp.sector),
    skills: list(sp.skill),
    gradMin: sp.gradMin ?? "",
    gradMax: sp.gradMax ?? "",
    // Keyset paging, so there is no page number. The field stays on the
    // shared MemberFilters shape because filterArgs() takes the whole
    // thing; nothing here reads it.
    page: 1,
  };
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { supabase, isAdmin, displayName, user } = await requireApprovedUser();
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "connections";
  // Card view is the default, and it is the default deliberately: it is
  // the accessible equivalent, it is the mobile experience, and it is the
  // one that carries the email address the feature exists for.
  const view: View = sp.view === "graph" ? "graph" : "cards";
  const filters = parseFilters(sp);
  const cursor = decodeCursor(sp.cursor);

  // Started, not awaited — see the note in app/vcs/page.tsx.
  const data = loadTab(supabase, tab, view, filters, cursor);

  return (
    <AppShell active="connections" name={displayName} isAdmin={isAdmin}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-8 rule-draw pt-4">
            <p className="label-wide text-text-muted mb-6">Connections</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-[clamp(1.75rem,3.5vw,2.5rem)]">
              People you can reach
            </h1>
            <p className="text-[0.875rem] text-text-muted mt-3 leading-relaxed max-w-[62ch]">
              A connection is a mutual agreement to share email addresses. Either of you
              can undo it at any time.
            </p>
          </div>

          <Suspense
            fallback={
              <>
                <FilterBarSkeleton />
                <CardGridSkeleton className="mt-8" count={6} />
              </>
            }
          >
            <Tabs data={data} tab={tab} view={view} filters={filters} myEmail={user.email ?? ""} displayName={displayName} />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}

type TabData = {
  connections: ConnectionsPage | null;
  pending: RequestsPage<PendingRequest> | null;
  sent: RequestsPage<SentRequest> | null;
  facets: Awaited<ReturnType<typeof myConnectionFacets>> | null;
  graph: ConnectionGraph | null;
  consentVersion: string;
};

async function loadTab(
  supabase: Parameters<typeof myConnectionsPage>[0],
  tab: Tab,
  view: View,
  filters: MemberFilters,
  cursor: ReturnType<typeof decodeCursor>,
): Promise<TabData> {
  // The consent version is needed on two of the three tabs (sending from
  // nowhere here, accepting on `pending`), and it is one row from a tiny
  // table, so it is fetched alongside rather than conditionally.
  if (tab === "pending") {
    const [pending, version] = await Promise.all([
      myPendingRequestsPage(supabase, cursor),
      consentVersion(supabase),
    ]);
    return { connections: null, pending, sent: null, facets: null, graph: null, consentVersion: version };
  }

  if (tab === "sent") {
    const sent = await mySentRequestsPage(supabase, cursor);
    return { connections: null, pending: null, sent, facets: null, graph: null, consentVersion: "" };
  }

  // EXACTLY ONE OF THE TWO VIEWS IS FETCHED, never both, and that is not
  // only about saving a query.
  //
  // The card page carries an email address per row, and props reach the
  // browser in the RSC payload whether or not anything renders them — so
  // loading the cards behind the graph would put 48 addresses into the
  // HTML of a view whose entire design rule is that it carries none. The
  // graph is meant to be the surface that cannot become an accidental
  // bulk export; fetching the card data alongside it would quietly make
  // that untrue, and an e2e assertion on the page source catches it.
  //
  // Toggling is a server navigation, so each view arrives with its own
  // data and neither pays for the other.
  const graphView = view === "graph";
  const [connections, facets, version, graph] = await Promise.all([
    graphView ? Promise.resolve(null) : myConnectionsPage(supabase, filters, cursor),
    myConnectionFacets(supabase),
    consentVersion(supabase),
    graphView ? myConnectionGraph(supabase, filters) : Promise.resolve(null),
  ]);
  return { connections, pending: null, sent: null, facets, graph, consentVersion: version };
}

async function Tabs({
  data, tab, view, filters, myEmail, displayName,
}: {
  data: Promise<TabData>;
  tab: Tab;
  view: View;
  filters: MemberFilters;
  myEmail: string;
  displayName: string;
}) {
  const d = await data;
  return (
    <ConnectionsClient
      tab={tab}
      view={view}
      displayName={displayName}
      graph={d.graph}
      filters={filters}
      myEmail={myEmail}
      consentVersion={d.consentVersion}
      connections={d.connections}
      pending={d.pending}
      sent={d.sent}
      facets={d.facets}
    />
  );
}
