"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import SearchableMultiSelect from "@/components/forms/SearchableMultiSelect";
import { useUrlFilters, useSearchDraft } from "@/lib/filters/useUrlFilters";
import { SearchInput, FilterPanel, ChipGroup, RangeFilter } from "@/components/filters/FilterBar";
import { Button } from "@/components/ui/Button";
import { MemberCard } from "@/components/members/MemberCard";
import { MemberDialog } from "@/components/members/MemberDialog";
import { EmailCopy } from "@/components/connections/EmailCopy";
import { ConfirmDialog } from "@/components/connections/ConfirmDialog";
import { AcceptDialog } from "@/components/connections/AcceptDialog";
import { ReportDialog } from "@/components/connections/ReportDialog";
import { invalidatePendingBadge } from "@/components/connections/PendingBadge";
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
    loading: () => (
      <div
        className="h-[420px] animate-pulse rounded-2xl border border-border bg-bg-card"
        aria-busy="true"
        aria-label="Loading your network"
      />
    ),
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
// ════════════════════════════════════════════════════════════════════

export type Tab = "connections" | "pending" | "sent";
export type View = "cards" | "graph";

const TAB_LABELS: Record<Tab, string> = {
  connections: "Your connections",
  pending: "Requests",
  sent: "Sent",
};

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
      <nav aria-label="Connections views" className="mb-6 flex flex-wrap gap-1.5">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-current={t === tab ? "page" : undefined}
            // The tab lives in the URL so the digest email can link
            // straight at ?tab=pending. Changing it drops the cursor:
            // a keyset cursor from one list means nothing in another.
            onClick={() => url.apply({ tab: t === "connections" ? null : t, cursor: null })}
            className={`cursor-pointer rounded-lg border px-3.5 py-2 text-[0.8rem] transition-colors duration-150 ${
              t === tab
                ? "border-accent bg-accent font-medium text-bg-primary"
                : "border-border-strong bg-white/[0.02] text-text-secondary hover:border-accent hover:text-text-primary"
            }`}
          >
            {TAB_LABELS[t]}
            {t === "pending" && pending?.total ? ` (${pending.total})` : ""}
          </button>
        ))}
      </nav>

      <div className={url.pending ? "opacity-60 transition-opacity duration-150" : undefined}>
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

  const gradYearBounds =
    facets && facets.grad_min != null && facets.grad_max != null
      ? { min: facets.grad_min, max: facets.grad_max }
      : null;

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setLoadError(null);
    const res = await loadMoreConnections(cursor, filters);
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

      {facets && (
        <FilterPanel
          activeCount={activeFilterCount}
          onClear={() => url.clear("role", "course", "sector", "skill", "gradMin", "gradMax")}
          resultCount={
            <>
              {graph ? graph.total : page?.total ?? items.length}
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

      <ViewToggle view={view} url={url} />

      {graphUnavailable ? (
        // Mid-navigation back to the card view. The same skeleton the graph
        // itself loads behind, so the swap reads as one load rather than
        // two, and it is never on screen long enough to need copy.
        <div
          className="h-[420px] animate-pulse rounded-2xl border border-border bg-bg-card"
          aria-busy="true"
          aria-label="Loading your connections"
        />
      ) : view === "graph" && graph ? (
        graph.nodes.length === 0 ? (
          <EmptyState
            title={activeFilterCount > 0 || filters.q ? "Nothing matches those filters." : "No connections yet."}
            body={
              activeFilterCount > 0 || filters.q
                ? "Clear the filters to see everyone you're connected to."
                : "Find someone in the directory and send them a request. If they accept, you'll each be able to see the other's email address."
            }
          />
        ) : (
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
        )
      ) : items.length === 0 ? (
        <EmptyState
          title={activeFilterCount > 0 || filters.q ? "Nothing matches those filters." : "No connections yet."}
          body={
            activeFilterCount > 0 || filters.q
              ? "Clear the filters to see everyone you're connected to."
              : "Find someone in the directory and send them a request. If they accept, you'll each be able to see the other's email address."
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((c) => (
            <div key={c.connectionId} className="flex flex-col gap-2">
              <MemberCard member={c} onClick={() => setOpen(c)} />
              <div className="rounded-xl border border-border bg-bg-card p-3 space-y-2">
                {c.email ? (
                  <EmailCopy email={c.email} name={c.firstName} />
                ) : (
                  // Only reachable if the other account is mid-deletion:
                  // the address is joined live from auth.users, never
                  // snapshot, so it disappears the moment they do.
                  <p className="text-[0.75rem] text-text-muted">
                    This member&apos;s address is no longer available.
                  </p>
                )}
                <div className="flex items-center gap-1.5">
                  <ActionButton
                    onClick={() => setRemoving(c)}
                    label={`Remove your connection with ${c.firstName} ${c.surname}`}
                  >
                    Remove
                  </ActionButton>
                  <ActionButton
                    onClick={() => setBlocking(c)}
                    label={`Block ${c.firstName} ${c.surname}`}
                  >
                    Block
                  </ActionButton>
                  <ActionButton
                    onClick={() => setReporting(c)}
                    label={`Report ${c.firstName} ${c.surname}`}
                  >
                    Report
                  </ActionButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "cards" && <LoadMore cursor={cursor} loading={loading} error={loadError} onClick={more} />}

      {open && <MemberDialog member={open} onClose={() => setOpen(null)} />}

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
          onSuccess={() => drop(removing.connectionId)}
          onClose={() => setRemoving(null)}
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
// Incoming requests
// ────────────────────────────────────────────────────────────────────

function PendingTab({
  page, myEmail, consentVersion,
}: {
  page: RequestsPage<PendingRequest>;
  myEmail: string;
  consentVersion: string;
}) {
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
    const res = await loadMorePendingRequests(cursor);
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
        <p
          role="status"
          className="mb-4 rounded-lg border border-border-strong bg-white/[0.05] px-4 py-3 text-[0.85rem] text-text-secondary"
        >
          You&apos;re connected with {justAccepted}.{" "}
          <Link
            href="/connections"
            className="text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent"
          >
            See your connections and their contact details
          </Link>
          .
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No requests waiting."
          body="When someone asks to connect, it shows up here with their profile and anything they wrote."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((r) => (
            <div key={r.connectionId} className="flex flex-col gap-2">
              <MemberCard member={r} onClick={() => setOpen(r)} />
              <div className="rounded-xl border border-border bg-bg-card p-3 space-y-2.5">
                {r.note && (
                  // Plain text, never HTML, and it never leaves the app —
                  // the digest email carries names and counts only, so an
                  // abusive note cannot reach an inbox.
                  <blockquote className="rounded-lg border-l-2 border-border-strong bg-white/[0.03] px-3 py-2 text-[0.78rem] text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
                    {r.note}
                  </blockquote>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setAccepting(r)}
                    aria-label={`Accept the request from ${r.firstName} ${r.surname}`}
                  >
                    Accept
                  </Button>
                  <ActionButton
                    onClick={() => setDeclining(r)}
                    label={`Decline the request from ${r.firstName} ${r.surname}`}
                  >
                    Decline
                  </ActionButton>
                  {/* Block is its own control, never folded into decline.
                      Buried inside a decline flow, people decline when
                      they mean to block and the one signal that drives
                      the reputation throttle goes quiet. */}
                  <ActionButton
                    onClick={() => setBlocking(r)}
                    label={`Block ${r.firstName} ${r.surname}`}
                  >
                    Block
                  </ActionButton>
                  <ActionButton
                    onClick={() => setReporting(r)}
                    label={`Report ${r.firstName} ${r.surname}`}
                  >
                    Report
                  </ActionButton>
                </div>
              </div>
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
          onSuccess={() => drop(declining.connectionId)}
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
    const res = await loadMoreSentRequests(cursor);
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
      <p className="mb-4 text-[0.8rem] text-text-muted leading-relaxed max-w-[62ch]">
        Requests you&apos;ve sent that haven&apos;t been answered yet. Answered ones move
        to <strong className="text-text-secondary">Your connections</strong>; declined
        ones simply disappear, and we don&apos;t tell you which.
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="No requests outstanding."
          body="Anyone you ask to connect will show up here until they reply."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((r) => (
            <div key={r.connectionId} className="flex flex-col gap-2">
              <MemberCard member={r} onClick={() => setOpen(r)} />
              <div className="rounded-xl border border-border bg-bg-card p-3">
                <ActionButton
                  onClick={() => setWithdrawing(r)}
                  label={`Withdraw your request to ${r.firstName} ${r.surname}`}
                >
                  Withdraw request
                </ActionButton>
              </div>
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
          onConfirm={() => withdrawConnectionRequest({ connectionId: withdrawing.connectionId })}
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
    <div className="mb-5 hidden sm:flex items-center gap-1.5">
      {([
        { value: "cards", label: "Cards" },
        { value: "graph", label: "Network" },
      ] as const).map((v) => (
        <button
          key={v.value}
          type="button"
          disabled={url.pending}
          aria-pressed={view === v.value}
          onClick={() => url.apply({ view: v.value === "cards" ? null : v.value, cursor: null })}
          className={
            "cursor-pointer rounded-lg border px-3 py-1.5 text-[0.75rem] transition-colors duration-150 " +
            (view === v.value
              ? "border-accent bg-white/[0.05] text-text-primary"
              : "border-border-strong bg-white/[0.02] text-text-secondary hover:border-accent hover:text-text-primary")
          }
        >
          {v.label}
        </button>
      ))}
      <p className="ml-2 text-[0.7rem] text-text-muted">
        {view === "graph"
          ? "Your connections, grouped. Email addresses are on the cards."
          : "The list, with each person's email address."}
      </p>
    </div>
  );
}

// `label` is REQUIRED and is the accessible name, not a decoration.
//
// The visible text has to stay short enough to sit three-across under a
// card, which means a full page of connections renders 144 buttons whose
// names are "Remove", "Block" and "Report" — forty-eight times each. Read
// out of context, as a screen reader's element list reads them, that is
// not a list of controls, it is the same three words repeated, and none of
// them says who they act on. The visible label is for people who can see
// which card it is under; `label` is for everyone else.
function ActionButton({
  onClick, label, children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // A visible shape, not bare text. Every control in this app has an
      // outline and a surface — bare-text controls are a recurring
      // regression here and they do not read as controls at all.
      className="cursor-pointer rounded-lg border border-border-strong bg-white/[0.05] px-2.5 py-1.5 text-[0.725rem] text-text-secondary transition-colors hover:border-accent hover:text-text-primary hover:bg-white/[0.10]"
    >
      {children}
    </button>
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
    <div className="mt-6 flex flex-col items-center gap-2">
      <Button variant="ghost" size="sm" loading={loading} onClick={onClick}>
        Load more
      </Button>
      {error && (
        <p role="alert" className="text-center text-[0.8rem] text-[#ff8080]">
          {error}
        </p>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center">
      <p className="text-[0.95rem] text-text-primary">{title}</p>
      <p className="mx-auto mt-2 max-w-[48ch] text-[0.85rem] text-text-muted leading-relaxed">
        {body}
      </p>
      <a
        href="/members"
        className="mt-5 inline-flex rounded-lg border border-border-strong bg-white/[0.05] px-4 py-2 text-[0.8rem] text-text-primary no-underline transition-colors hover:border-accent hover:bg-white/[0.10]"
      >
        Browse the directory
      </a>
    </div>
  );
}
