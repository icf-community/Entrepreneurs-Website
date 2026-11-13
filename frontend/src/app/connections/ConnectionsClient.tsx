"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import SearchableMultiSelect from "@/components/forms/SearchableMultiSelect";
import { useUrlFilters, useSearchDraft } from "@/lib/filters/useUrlFilters";
import { SearchInput, FilterPanel, ChipGroup, RangeFilter } from "@/components/filters/FilterBar";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { ButtonTabs, TabCount } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorBanner } from "@/components/forms/Banners";
import type { IconName } from "@/design-system/icons/names";
import { MemberCard } from "@/components/members/MemberCard";
import { MemberDialog } from "@/components/members/MemberDialog";
import { EmailCopy } from "@/components/connections/EmailCopy";
import { ConfirmDialog } from "@/components/connections/ConfirmDialog";
import { AcceptDialog } from "@/components/connections/AcceptDialog";
import { ReportDialog } from "@/components/connections/ReportDialog";
import { invalidatePendingBadge } from "@/components/connections/pendingBadgeStore";
import {
  removeConnection,
  blockMember,
  withdrawConnectionRequest,
  respondToConnectionRequest,
  loadMoreConnections,
  loadMorePendingRequests,
  loadMoreSentRequests,
} from "./actions";
// Type-only, so the server-only modules are erased rather than imported.
import type { DirectoryMember, Facets, MemberFilters } from "@/lib/data/directory";
import type {
  Connection,
  ConnectionsPage,
  ConnectionGraph as GraphData,
  PendingRequest,
  RequestsPage,
  SentRequest,
} from "@/lib/data/connections";
import { settle } from "@/lib/settle";
import { Updating } from "@/components/ui/Updating";
import { track } from "@/lib/analytics/track";

// d3-force is ~30 KB and is used by one optional view that is not the
// default. Loaded on demand so it never enters the card-view bundle and
// can never become the LCP element.
//
// `ssr: false` because the layout runs 300 simulation ticks: doing that
// on the server would block the response to produce coordinates the
// client is going to recompute anyway at its own viewBox.
const ConnectionGraph = dynamic(
  () => import("@/components/connections/ConnectionGraph").then((m) => m.ConnectionGraph),
  {
    ssr: false,
    loading: () => <GraphSkeleton label="Loading your network" />,
  },
);

// ════════════════════════════════════════════════════════════════════
// Foundry · /connections, client side
//
// Three lists that are one component because they share the card, the
// empty state, the dialogs and the load-more. What they do not share is
// what each row can do, and that is the only thing that branches below.
//
// COLD START IS THE DEFAULT STATE, not an edge case. On day one nobody
// has a connection, so every empty state points at /members. A tab that
// reads "nothing here" indefinitely is worse than the honest "Coming
// soon" this page replaced.
//
// Rows are removed from the local list on success rather than waiting
// for a refetch. revalidatePath fires server-side too, but the feed
// component seeds state from props and React ignores prop changes after
// mount — the lesson community/actions.ts records. The list the member
// is looking at has to be told.
//
// The look: the three lists are line tabs (the URL says which), each person
// is the directory's own card with a quiet tray under it (the address and
// the actions on one inset surface), and every empty list is the system's
// empty state with the same next step, the directory. The row actions stay
// real buttons on the page, named for the person they act on.
// ════════════════════════════════════════════════════════════════════

export type Tab = "connections" | "pending" | "sent";
export type View = "cards" | "graph";

// One grid for every list of people here (connections, requests, sent).
const CARD_GRID = "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3";

export default function ConnectionsClient({
  tab, view, displayName, graph, filters, myEmail, consentVersion,
  connections, pending, sent, facets,
}: {
  tab: Tab;
  view: View;
  displayName: string;
  graph: GraphData | null;
  filters: MemberFilters;
  myEmail: string;
  consentVersion: string;
  connections: ConnectionsPage | null;
  pending: RequestsPage<PendingRequest> | null;
  sent: RequestsPage<SentRequest> | null;
  facets: Facets | null;
}) {
  const url = useUrlFilters({ navigate: "server", resetKey: "cursor" });

  // Remount the active tab whenever the server sends a different page.
  //
  // Each tab seeds `items` from props with useState, so that it can drop a
  // row locally the moment an action succeeds instead of waiting for a
  // refetch — and useState ignores every prop change after mount. Without
  // this key, changing a filter or flipping the view re-rendered the tab
  // with new props and left the OLD list on screen: filters appeared to do
  // nothing, and switching back from the network view showed an empty
  // list. Exactly the trap the header note above describes, arrived at
  // from the other direction.
  const pageKey = `${tab}|${view}|${JSON.stringify(filters)}`;

  return (
    <>
      {/* The tab lives in the URL so the digest email can link straight at
          ?tab=pending. Changing it drops the cursor: a keyset cursor from one
          list means nothing in another. */}
      <ButtonTabs
        semantics="current"
        label="Connections views"
        value={tab}
        className="mb-6"
        items={[
          { value: "connections", label: "Your connections" },
          {
            value: "pending",
            label: (
              <>
                Requests
                {pending?.total ? (
                  <>
                    {" "}
                    <TabCount>({pending.total})</TabCount>
                  </>
                ) : null}
              </>
            ),
          },
          { value: "sent", label: "Sent" },
        ]}
        onSelect={(next) => url.apply({ tab: next === "connections" ? null : next, cursor: null })}
      />

      <div className={`relative ${url.pending ? "opacity-60 transition-opacity duration-150" : ""}`} aria-busy={url.pending || undefined}>
        {url.pending && <Updating />}
        {tab === "connections" && (connections || graph) && (
          <ConnectionsTab
            key={pageKey}
            page={connections}
            facets={facets}
            filters={filters}
            url={url}
            view={view}
            graph={graph}
            displayName={displayName}
          />
        )}
        {tab === "pending" && pending && (
          <PendingTab key={pageKey} page={pending} myEmail={myEmail} consentVersion={consentVersion} />
        )}
        {tab === "sent" && sent && <SentTab key={pageKey} page={sent} />}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Your connections
// ────────────────────────────────────────────────────────────────────

// Tailwind's `sm` breakpoint, stated once. The view toggle is
// `hidden sm:flex`, so this query has to be that same boundary or the two
// disagree about what counts as a small screen.
const NARROW = "(max-width: 639px)";

// Server snapshot is `false` — assume wide, which is what the toggle
// itself renders on the server. useSyncExternalStore rather than a
// useState/useEffect pair so the first client render already knows the
// answer instead of hydrating wide and correcting itself.
function useNarrowViewport() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

function ConnectionsTab({
  page, facets, filters, url, view, graph, displayName,
}: {
  // Null in graph view. Exactly one of the two views is fetched — see the
  // note in page.tsx: the card rows carry email addresses, and props reach
  // the browser in the RSC payload whether or not anything renders them.
  page: ConnectionsPage | null;
  facets: Facets | null;
  filters: MemberFilters;
  url: ReturnType<typeof useUrlFilters>;
  view: View;
  graph: GraphData | null;
  displayName: string;
}) {
  const [queryDraft, setQueryDraft] = useSearchDraft(url);
  const [items, setItems] = useState(page?.connections ?? []);
  const [cursor, setCursor] = useState(page?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<DirectoryMember | null>(null);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const [blocking, setBlocking] = useState<Connection | null>(null);
  const [reporting, setReporting] = useState<Connection | null>(null);

  // A phone that lands on ?view=graph — a link shared from a desktop, a
  // bookmark, the back button — was a dead end: the graph is desktop-only
  // by design and the toggle that would switch back is `hidden sm:flex`,
  // so there was no control on screen to leave with.
  //
  // Handled as a navigation, not a local clamp. The server fetches exactly
  // one of the two payloads (see page.tsx), so in graph view the card rows
  // are not in this component to fall back to; rendering `cards` here
  // would show "No connections yet" to someone with connections.
  //
  // The ref stops a second navigation firing while the first is still in
  // flight — `view` stays "graph" until the new page arrives, and this
  // component is keyed on it, so the ref resets exactly when it should.
  const narrow = useNarrowViewport();
  const leftGraph = useRef(false);
  useEffect(() => {
    if (narrow && view === "graph" && !leftGraph.current) {
      leftGraph.current = true;
      url.apply({ view: null, cursor: null });
    }
  }, [narrow, view, url]);
  const graphUnavailable = narrow && view === "graph";

  const activeFilterCount =
    filters.roles.length + filters.courses.length + filters.sectors.length +
    filters.skills.length + (filters.gradMin ? 1 : 0) + (filters.gradMax ? 1 : 0);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setLoadError(null);
    const res = await settle(loadMoreConnections(cursor, filters));
    setLoading(false);
    if (!res.ok) { setLoadError(res.error); return; }
    setItems((prev) => [...prev, ...res.data.connections]);
    setCursor(res.data.nextCursor);
  }

  const drop = (id: string) => setItems((prev) => prev.filter((c) => c.connectionId !== id));

  return (
    <>
      <SearchInput
        label="Search your connections"
        placeholder="Search by name, course, skill, sector, or what they're working on"
        value={queryDraft}
        onChange={setQueryDraft}
      />

      <ConnectionsFilterPanel
        facets={facets}
        filters={filters}
        url={url}
        activeFilterCount={activeFilterCount}
        resultCount={graph ? graph.total : page?.total ?? items.length}
      />

      <ViewToggle view={view} url={url} />

      <ConnectionsResultsView
        view={view}
        graph={graph}
        graphUnavailable={graphUnavailable}
        activeFilterCount={activeFilterCount}
        filters={filters}
        items={items}
        url={url}
        displayName={displayName}
        cursor={cursor}
        loading={loading}
        loadError={loadError}
        onLoadMore={more}
        onOpen={setOpen}
        onRemove={setRemoving}
        onBlock={setBlocking}
        onReport={setReporting}
      />

      <ConnectionsTabDialogs
        open={open}
        onCloseOpen={() => setOpen(null)}
        removing={removing}
        onCloseRemoving={() => setRemoving(null)}
        blocking={blocking}
        onCloseBlocking={() => setBlocking(null)}
        reporting={reporting}
        onCloseReporting={() => setReporting(null)}
        onDrop={drop}
      />
    </>
  );
}

/**
 * Search facets for Your connections — the role/course/sector/skill/
 * grad-year filters, plus the "couldn't load" fallback when facets failed
 * to fetch. Pulled out of ConnectionsTab: it is pure rendering off of
 * `facets`/`filters`/`url`, no state of its own.
 */
function ConnectionsFilterPanel({
  facets, filters, url, activeFilterCount, resultCount,
}: {
  facets: Facets | null;
  filters: MemberFilters;
  url: ReturnType<typeof useUrlFilters>;
  activeFilterCount: number;
  resultCount: number;
}) {
  const gradYearBounds =
    facets && facets.grad_min != null && facets.grad_max != null
      ? { min: facets.grad_min, max: facets.grad_max }
      : null;

  return (
    <>
      {facets?.unavailable && (
        <div className="mb-6">
          <Notice role="status" tone="lit">
            Couldn&apos;t load the filters. Reload to try again.
          </Notice>
        </div>
      )}
      {facets && !facets.unavailable && (
        <FilterPanel
          activeCount={activeFilterCount}
          onClear={() => url.clear("role", "course", "sector", "skill", "gradMin", "gradMax")}
          resultCount={
            <>
              {resultCount}
              <span className="sr-only"> connections match</span>
            </>
          }
        >
          <ChipGroup
            label="Role"
            options={[
              { value: "student", label: "Students" },
              { value: "recent_grad", label: "Recent grads" },
              { value: "alum", label: "Alumni" },
              { value: "mentor", label: "Mentors" },
            ]}
            selected={new Set(filters.roles)}
            onToggle={(v) => url.toggle("role", v)}
          />

          {facets.courses.length > 0 && (
            <SearchableMultiSelect
              label="Course"
              options={facets.courses}
              selected={new Set(filters.courses)}
              onChange={(next) => url.apply({ course: [...next] })}
              placeholder="Filter by course — search or pick"
              emptyText="No course matches that search."
            />
          )}

          {facets.sectors.length > 0 && (
            <ChipGroup
              label="Sectors"
              options={facets.sectors.map((s) => ({ value: s, label: s }))}
              selected={new Set(filters.sectors)}
              onToggle={(v) => url.toggle("sector", v)}
            />
          )}

          {facets.skills.length > 0 && (
            <ChipGroup
              label="Skills"
              options={facets.skills.map((s) => ({ value: s, label: s }))}
              selected={new Set(filters.skills)}
              onToggle={(v) => url.toggle("skill", v)}
            />
          )}

          {gradYearBounds && (
            <RangeFilter
              label="Graduation year"
              hint={` — range ${gradYearBounds.min}–${gradYearBounds.max}`}
              type="number"
              bounds={gradYearBounds}
              from={filters.gradMin}
              to={filters.gradMax}
              fromLabel="Graduation year from"
              toLabel="Graduation year to"
              fromPlaceholder={`From ${gradYearBounds.min}`}
              toPlaceholder={`To ${gradYearBounds.max}`}
              commitOn="blur"
              onFromChange={(v) => url.apply({ gradMin: v })}
              onToChange={(v) => url.apply({ gradMax: v })}
            />
          )}
        </FilterPanel>
      )}
    </>
  );
}

/**
 * Graph-or-cards body for Your connections, plus the Load more control.
 * Pulled out of ConnectionsTab because the view/graph/items branching was
 * the bulk of that function's control flow; this piece holds no state,
 * only the row actions passed down as callbacks.
 */
function ConnectionsResultsView({
  view, graph, graphUnavailable, activeFilterCount, filters, items, url,
  displayName, cursor, loading, loadError, onLoadMore,
  onOpen, onRemove, onBlock, onReport,
}: {
  view: View;
  graph: GraphData | null;
  graphUnavailable: boolean;
  activeFilterCount: number;
  filters: MemberFilters;
  items: Connection[];
  url: ReturnType<typeof useUrlFilters>;
  displayName: string;
  cursor: string | null;
  loading: boolean;
  loadError: string | null;
  onLoadMore: () => void;
  onOpen: (m: DirectoryMember) => void;
  onRemove: (c: Connection) => void;
  onBlock: (c: Connection) => void;
  onReport: (c: Connection) => void;
}) {
  return (
    <>
      <ConnectionsBody
        view={view}
        graph={graph}
        graphUnavailable={graphUnavailable}
        activeFilterCount={activeFilterCount}
        filters={filters}
        items={items}
        url={url}
        displayName={displayName}
        onOpen={onOpen}
        onRemove={onRemove}
        onBlock={onBlock}
        onReport={onReport}
      />

      {view === "cards" && <LoadMore cursor={cursor} loading={loading} error={loadError} onClick={onLoadMore} />}
    </>
  );
}

// Same empty copy whether the graph came back with no nodes or the card
// list came back with no items — the two lists are the same underlying
// data, just two renderings of it, so this is computed once rather than
// written out at both call sites below.
function connectionsEmptyCopy(activeFilterCount: number, filters: MemberFilters) {
  const filtered = activeFilterCount > 0 || filters.q;
  const icon: IconName = filtered ? "search" : "connections";
  return {
    icon,
    title: filtered ? "Nothing matches those filters." : "No connections yet.",
    body: filtered
      ? "Clear the filters to see everyone you're connected to."
      : "Find someone in the directory and send them a request. If they accept, you'll each be able to see the other's email address.",
  };
}

/**
 * Picks between the graph-unavailable skeleton, the network graph, the
 * empty state and the card grid. Split out of ConnectionsResultsView so the
 * branching that decides WHAT to show is separate from the Load More
 * control and from the grid's own per-row markup.
 */
function ConnectionsBody({
  view, graph, graphUnavailable, activeFilterCount, filters, items, url, displayName,
  onOpen, onRemove, onBlock, onReport,
}: {
  view: View;
  graph: GraphData | null;
  graphUnavailable: boolean;
  activeFilterCount: number;
  filters: MemberFilters;
  items: Connection[];
  url: ReturnType<typeof useUrlFilters>;
  displayName: string;
  onOpen: (m: DirectoryMember) => void;
  onRemove: (c: Connection) => void;
  onBlock: (c: Connection) => void;
  onReport: (c: Connection) => void;
}) {
  if (graphUnavailable) {
    // Mid-navigation back to the card view. The same skeleton the graph
    // itself loads behind, so the swap reads as one load rather than two,
    // and it is never on screen long enough to need copy.
    return <GraphSkeleton label="Loading your connections" />;
  }

  if (view === "graph" && graph) {
    if (graph.nodes.length === 0) {
      const copy = connectionsEmptyCopy(activeFilterCount, filters);
      return <DirectoryEmpty icon={copy.icon} title={copy.title}>{copy.body}</DirectoryEmpty>;
    }
    return (
      <ConnectionGraph
        nodes={graph.nodes}
        total={graph.total}
        myName={displayName}
        // Selecting a node switches to the card view scoped to that
        // person, rather than opening a dialog from the graph payload.
        //
        // Not a shortcut. The graph plots up to 500 nodes while the
        // card list pages at 48, so a dialog built from what the graph
        // holds would work for the loaded page and silently do nothing
        // for everybody else — and it would have no email address on
        // it, which is the one thing someone clicking a node is trying
        // to reach. Handing them the card is handing them the answer.
        onSelect={(id) => {
          const node = graph.nodes.find((n) => n.id === id);
          if (!node) return;
          url.apply({
            view: null,
            q: `${node.firstName} ${node.surname}`,
            cursor: null,
          });
        }}
      />
    );
  }

  if (items.length === 0) {
    const copy = connectionsEmptyCopy(activeFilterCount, filters);
    return <DirectoryEmpty icon={copy.icon} title={copy.title}>{copy.body}</DirectoryEmpty>;
  }

  return (
    <ConnectionsCardGrid items={items} onOpen={onOpen} onRemove={onRemove} onBlock={onBlock} onReport={onReport} />
  );
}

/** The actual connections grid: one card plus its action row per connection. */
function ConnectionsCardGrid({
  items, onOpen, onRemove, onBlock, onReport,
}: {
  items: Connection[];
  onOpen: (m: DirectoryMember) => void;
  onRemove: (c: Connection) => void;
  onBlock: (c: Connection) => void;
  onReport: (c: Connection) => void;
}) {
  return (
    <div className={CARD_GRID}>
      {items.map((c) => (
        <div key={c.connectionId} className="flex flex-col gap-2">
          <CardFrame><MemberCard member={c} onClick={() => onOpen(c)} /></CardFrame>
          <Panel tone="inset" size="sm" className="grid grid-cols-1 gap-3 p-3">
            {c.email ? (
              <EmailCopy email={c.email} name={c.firstName} />
            ) : (
              // Only reachable if the other account is mid-deletion:
              // the address is joined live from auth.users, never
              // snapshot, so it disappears the moment they do.
              <p className="text-small text-text-muted">
                This member&apos;s address is no longer available.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="dangerGhost"
                size="sm"
                onClick={() => onRemove(c)}
                aria-label={`Remove your connection with ${c.firstName} ${c.surname}`}
              >
                Remove
              </Button>
              <Button
                variant="dangerGhost"
                size="sm"
                onClick={() => onBlock(c)}
                aria-label={`Block ${c.firstName} ${c.surname}`}
              >
                Block
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReport(c)}
                aria-label={`Report ${c.firstName} ${c.surname}`}
              >
                Report
              </Button>
            </div>
          </Panel>
        </div>
      ))}
    </div>
  );
}

/**
 * The four modals a connections-grid row can open: the profile dialog plus
 * remove/block/report. Pulled out of ConnectionsTab as one piece since they
 * share nothing but being conditionally mounted off of that component's
 * dialog state.
 */
function ConnectionsTabDialogs({
  open, onCloseOpen, removing, onCloseRemoving, blocking, onCloseBlocking,
  reporting, onCloseReporting, onDrop,
}: {
  open: DirectoryMember | null;
  onCloseOpen: () => void;
  removing: Connection | null;
  onCloseRemoving: () => void;
  blocking: Connection | null;
  onCloseBlocking: () => void;
  reporting: Connection | null;
  onCloseReporting: () => void;
  onDrop: (connectionId: string) => void;
}) {
  return (
    <>
      {open && <MemberDialog member={open} onClose={onCloseOpen} />}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.firstName} ${removing.surname}?`}
          body={
            <>
              <p>
                You&apos;ll both stop seeing each other&apos;s email address in Foundry, and
                the connection disappears for both of you.
              </p>
              <p>
                It can&apos;t un-send an address someone already has. Either of you can send
                a new request later.
              </p>
            </>
          }
          confirmLabel="Remove connection"
          onConfirm={() => removeConnection({ connectionId: removing.connectionId })}
          onSuccess={() => onDrop(removing.connectionId)}
          onClose={onCloseRemoving}
        />
      )}

      {blocking && (
        <ConfirmDialog
          title={`Block ${blocking.firstName} ${blocking.surname}?`}
          body={
            <>
              <p>
                This removes your connection and stops them sending you requests. They
                are not told.
              </p>
              <p>You can undo it from your connection settings.</p>
            </>
          }
          confirmLabel="Block member"
          onConfirm={() => blockMember({ memberId: blocking.id })}
          onSuccess={() => onDrop(blocking.connectionId)}
          onClose={onCloseBlocking}
        />
      )}

      {reporting && (
        <ReportDialog
          connectionId={reporting.connectionId}
          theirName={`${reporting.firstName} ${reporting.surname}`}
          onClose={onCloseReporting}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Incoming requests
// ────────────────────────────────────────────────────────────────────

function PendingTab({
  page, myEmail, consentVersion,
}: {
  page: RequestsPage<PendingRequest>;
  myEmail: string;
  consentVersion: string;
}) {
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- seeded once per key={pageKey} remount (see header comment); key already forces resync on filter/tab change, no staleness window
  const [items, setItems] = useState(page.requests);
  const [cursor, setCursor] = useState(page.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<DirectoryMember | null>(null);
  const [accepting, setAccepting] = useState<PendingRequest | null>(null);
  const [declining, setDeclining] = useState<PendingRequest | null>(null);
  const [blocking, setBlocking] = useState<PendingRequest | null>(null);
  const [reporting, setReporting] = useState<PendingRequest | null>(null);
  const [justAccepted, setJustAccepted] = useState<string | null>(null);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setLoadError(null);
    const res = await settle(loadMorePendingRequests(cursor));
    setLoading(false);
    if (!res.ok) { setLoadError(res.error); return; }
    setItems((prev) => [...prev, ...res.data.requests]);
    setCursor(res.data.nextCursor);
  }

  // Every route out of this list — accepted, declined, blocked — is a route
  // that changes the sidebar count. The badge caches for a minute in module
  // state, so without this the member clears their last request and the
  // nav still says "1" until the cache expires, which reads as the action
  // not having worked. This is the one place all three converge.
  const drop = (id: string) => {
    invalidatePendingBadge();
    setItems((prev) => prev.filter((r) => r.connectionId !== id));
  };

  return (
    <>
      {justAccepted && (
        <div className="mb-6">
          <Notice role="status" tone="success">
            You&apos;re connected with {justAccepted}.{" "}
            <Link href="/connections">View your network</Link>
          </Notice>
        </div>
      )}

      {items.length === 0 ? (
        <DirectoryEmpty icon="user-plus" title="No requests waiting.">
          When someone asks to connect, it shows up here with their profile and anything they wrote.
        </DirectoryEmpty>
      ) : (
        <div className={CARD_GRID}>
          {items.map((r) => (
            <div key={r.connectionId} className="flex flex-col gap-2">
              <CardFrame><MemberCard member={r} onClick={() => setOpen(r)} /></CardFrame>
              <Panel tone="inset" size="sm" className="grid grid-cols-1 gap-3 p-3">
                {r.note && (
                  // Plain text, never HTML, and it never leaves the app —
                  // the digest email carries names and counts only, so an
                  // abusive note cannot reach an inbox.
                  <blockquote className="rounded-lg bg-tint-2 px-3.5 py-3 text-body leading-relaxed text-text-secondary whitespace-pre-wrap break-words">
                    {r.note}
                  </blockquote>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    onClick={() => setAccepting(r)}
                    aria-label={`Accept the request from ${r.firstName} ${r.surname}`}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setDeclining(r)}
                    aria-label={`Decline the request from ${r.firstName} ${r.surname}`}
                  >
                    Decline
                  </Button>
                  {/* Block is its own control, never folded into decline.
                      Buried inside a decline flow, people decline when
                      they mean to block and the one signal that drives
                      the reputation throttle goes quiet. */}
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    className="w-full"
                    onClick={() => setBlocking(r)}
                    aria-label={`Block ${r.firstName} ${r.surname}`}
                  >
                    Block
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setReporting(r)}
                    aria-label={`Report ${r.firstName} ${r.surname}`}
                  >
                    Report
                  </Button>
                </div>
              </Panel>
            </div>
          ))}
        </div>
      )}

      <LoadMore cursor={cursor} loading={loading} error={loadError} onClick={more} />

      {open && <MemberDialog member={open} onClose={() => setOpen(null)} />}

      {accepting && (
        <AcceptDialog
          connectionId={accepting.connectionId}
          theirName={`${accepting.firstName} ${accepting.surname}`}
          myEmail={myEmail}
          consentVersion={consentVersion}
          onAccepted={() => {
            setJustAccepted(`${accepting.firstName} ${accepting.surname}`);
            drop(accepting.connectionId);
          }}
          // Withdrawn, or already answered elsewhere, between the card
          // rendering and Accept landing — just drop it, no "connected"
          // banner: nothing here actually connected the two of you.
          onStale={() => drop(accepting.connectionId)}
          onClose={() => setAccepting(null)}
        />
      )}

      {declining && (
        <ConfirmDialog
          title={`Decline ${declining.firstName}'s request?`}
          body={
            <>
              <p>
                They are not told, and the request disappears from their sent list. No
                addresses are shared.
              </p>
              <p>
                They can&apos;t send you another request for three weeks. You can still send
                them one if you change your mind.
              </p>
            </>
          }
          confirmLabel="Decline"
          onConfirm={() =>
            respondToConnectionRequest({
              connectionId: declining.connectionId,
              accept: false,
              consentVersion,
            })
          }
          onSuccess={() => {
            track("connection_declined");
            drop(declining.connectionId);
          }}
          onClose={() => setDeclining(null)}
        />
      )}

      {blocking && (
        <ConfirmDialog
          title={`Block ${blocking.firstName} ${blocking.surname}?`}
          body={
            <>
              <p>
                This declines the request and stops them sending you another. They are
                not told.
              </p>
              <p>You can undo it from your connection settings.</p>
            </>
          }
          confirmLabel="Block member"
          onConfirm={() => blockMember({ memberId: blocking.id })}
          onSuccess={() => drop(blocking.connectionId)}
          onClose={() => setBlocking(null)}
        />
      )}

      {reporting && (
        <ReportDialog
          connectionId={reporting.connectionId}
          theirName={`${reporting.firstName} ${reporting.surname}`}
          onClose={() => setReporting(null)}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Outgoing requests
// ────────────────────────────────────────────────────────────────────

function SentTab({ page }: { page: RequestsPage<SentRequest> }) {
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- seeded once per key={pageKey} remount (see header comment); key already forces resync on filter/tab change, no staleness window
  const [items, setItems] = useState(page.requests);
  const [cursor, setCursor] = useState(page.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<DirectoryMember | null>(null);
  const [withdrawing, setWithdrawing] = useState<SentRequest | null>(null);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setLoadError(null);
    const res = await settle(loadMoreSentRequests(cursor));
    setLoading(false);
    if (!res.ok) { setLoadError(res.error); return; }
    setItems((prev) => [...prev, ...res.data.requests]);
    setCursor(res.data.nextCursor);
  }

  return (
    <>
      {/* The honest explanation for why this list is usually shorter than
          you expect. A decline removes the row entirely and tells nobody,
          which is the point — but without saying so, a member watching a
          request vanish concludes the site lost it. */}
      <p className="measure-prose mb-6 text-body leading-relaxed text-text-muted">
        Requests you&apos;ve sent that haven&apos;t been answered yet. Answered ones move
        to <strong className="font-semibold text-text-secondary">Your connections</strong>; declined
        ones simply disappear, and we don&apos;t tell you which.
      </p>

      {items.length === 0 ? (
        <DirectoryEmpty icon="send" title="No requests outstanding.">
          Anyone you ask to connect will show up here until they reply.
        </DirectoryEmpty>
      ) : (
        <div className={CARD_GRID}>
          {items.map((r) => (
            <div key={r.connectionId} className="flex flex-col gap-2">
              <CardFrame><MemberCard member={r} onClick={() => setOpen(r)} /></CardFrame>
              <Panel tone="inset" size="sm" className="p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setWithdrawing(r)}
                  aria-label={`Withdraw your request to ${r.firstName} ${r.surname}`}
                >
                  Withdraw request
                </Button>
              </Panel>
            </div>
          ))}
        </div>
      )}

      <LoadMore cursor={cursor} loading={loading} error={loadError} onClick={more} />

      {open && <MemberDialog member={open} onClose={() => setOpen(null)} />}

      {withdrawing && (
        <ConfirmDialog
          title={`Withdraw your request to ${withdrawing.firstName}?`}
          body={
            <p>
              The request disappears from their list. You won&apos;t be able to send them
              another for three weeks. They can still send you one.
            </p>
          }
          confirmLabel="Withdraw"
          onConfirm={async () => {
            const res = await withdrawConnectionRequest({ connectionId: withdrawing.connectionId });
            if (res.ok) track("connection_request_withdrawn");
            return res;
          }}
          onSuccess={() =>
            setItems((prev) => prev.filter((x) => x.connectionId !== withdrawing.connectionId))
          }
          onClose={() => setWithdrawing(null)}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared bits
// ────────────────────────────────────────────────────────────────────

/**
 * Cards or graph, on Your connections only.
 *
 * HIDDEN BELOW `sm`, and the graph is unreachable there. Pinch-zooming a
 * force layout on a phone is unpleasant, mobile is first-class here, and
 * the card view is the better small-screen experience by a wide margin —
 * so small screens get cards regardless of what the URL says. Hiding the
 * control rather than showing a disabled one avoids advertising something
 * that cannot be had.
 *
 * The view is in the URL for the same reason the tab is: it survives a
 * filter change, a back button, and a shared link.
 */
function ViewToggle({ view, url }: { view: View; url: ReturnType<typeof useUrlFilters> }) {
  return (
    <div className="mb-6 hidden items-center gap-4 sm:flex">
      <ButtonTabs
        label="View"
        variant="segmented"
        size="sm"
        value={view}
        disabled={url.pending}
        items={[
          { value: "cards", label: "Cards" },
          { value: "graph", label: "Network" },
        ]}
        onSelect={(next) => url.apply({ view: next === "cards" ? null : next, cursor: null })}
      />
      <p className="text-small text-text-muted">
        {view === "graph"
          ? "Your connections, grouped. Email addresses are on the cards."
          : "The list, with each person's email address."}
      </p>
    </div>
  );
}

// `error` is not optional polish. The three handlers behind this used to
// `return` on failure with the spinner already cleared, so a rate limit, an
// expired session or a dropped connection all looked identical to "you have
// reached the end of the list" — the button simply did nothing, and the
// member had no reason to press it again. A paging failure has to say it
// failed, in the same place the action was taken.
function LoadMore({
  cursor, loading, error, onClick,
}: {
  cursor: string | null;
  loading: boolean;
  error: string | null;
  onClick: () => void;
}) {
  if (!cursor) return null;
  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <Button variant="ghost" size="sm" loading={loading} onClick={onClick}>
        Load more
      </Button>
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </div>
  );
}

/**
 * Holds a member card to its cell. A long name or course on a 320 px phone can be wider than the card's
 * own grid track, and the page would then scroll sideways; the frame (same 14 px corner as the card)
 * keeps whatever does not fit inside the cell.
 */
function CardFrame({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 overflow-hidden rounded-xl">{children}</div>;
}

/** What every empty list here says, and the one thing to do next: the directory. */
function DirectoryEmpty({
  icon, title, children,
}: {
  icon: IconName;
  title: string;
  children: string;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      action={
        <ButtonLink href="/members" variant="ghost" size="md">
          Browse the directory
        </ButtonLink>
      }
    >
      {children}
    </EmptyState>
  );
}

/** The graph's own loading shape, and the beat between leaving it and the card list arriving. */
function GraphSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <Skeleton className="h-[420px] w-full rounded-xl" />
    </div>
  );
}
