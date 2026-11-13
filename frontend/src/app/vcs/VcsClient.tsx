"use client";

import { useEffect, useRef, useState } from "react";
import { useUrlFilters, useSearchDraft } from "@/lib/filters/useUrlFilters";
import { SearchInput, FilterPanel, ChipChoice, RangeFilter } from "@/components/filters/FilterBar";
import { Pager } from "@/components/ui/Pager";
import { useListingFreshness } from "@/lib/useListingFreshness";
import { ListingGoneNotice } from "@/components/ListingGoneNotice";
import { ExternalButtonLink, FullPageLink } from "@/components/FullPageLink";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import { formatDate } from "@/lib/dates";
import type { Vc, VcFilters } from "@/lib/data/vcs";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { Updating } from "@/components/ui/Updating";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";

const KINDS = [
  { value: "all",   label: "All" },
  { value: "vc",    label: "VCs" },
  { value: "grant", label: "Grants" },
] as const;

// ════════════════════════════════════════════════════════════════════
// Filtering and paging happen on the server; this component's job is to
// keep the URL in step with the controls. Same reasoning, same shape as
// MembersClient: search/kind/deadline are now Postgres query arguments,
// not a client-side .filter() over the whole approved list, so this page
// can no longer silently truncate past PostgREST's 1000-row cap the way
// the member directory used to. See lib/data/vcs.ts / migration
// 20260904000002.
// ════════════════════════════════════════════════════════════════════
export default function VcsClient({
  items, matching, filters, pageSize, appliedIds = [],
}: {
  items: Vc[];
  matching: number;
  filters: VcFilters;
  pageSize: number;
  /** VC/grant IDs the current user has self-marked as applied. */
  appliedIds?: string[];
}) {
  const url = useUrlFilters({ navigate: "server", resetKey: "page" });
  const [queryDraft, setQueryDraft] = useSearchDraft(url);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const appliedSet = new Set(appliedIds);

  const visible = items.filter((v) => !dismissed.has(v.id));
  const activeFilterCount = (filters.kind !== "all" ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0);

  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));

  return (
    <>
      <SearchInput
        label="Search VCs and grants"
        placeholder="Search by name, stage, or amount"
        value={queryDraft}
        onChange={setQueryDraft}
      />

      <FilterPanel
        activeCount={activeFilterCount}
        onClear={() => url.clear("kind", "from", "to")}
        resultCount={
          <>
            {matching}
            <span className="sr-only"> listings shown</span>
          </>
        }
      >
        <ChipChoice
          label="Kind"
          options={KINDS}
          value={filters.kind}
          onChange={(next) => url.apply({ kind: next === "all" ? null : next })}
        />

        <RangeFilter
          label="Deadline range"
          hint=" — when set, rolling-application listings are hidden"
          type="date"
          from={filters.from}
          to={filters.to}
          fromLabel="Deadline from date"
          toLabel="Deadline to date"
          // Every change here is now a database query, so wait for the
          // field to be finished with rather than filtering mid-pick.
          commitOn="blur"
          onFromChange={(v) => url.apply({ from: v })}
          onToChange={(v) => url.apply({ to: v })}
        />
      </FilterPanel>

      {/* A pending navigation dims the current page rather than replacing it
          with a skeleton: the results are still valid, just about to change,
          and swapping them for placeholders on every keystroke would flash. */}
      <div className={`relative ${url.pending ? "opacity-60 transition-opacity duration-150" : ""}`} aria-busy={url.pending || undefined}>
        {url.pending && <Updating />}
        {visible.length === 0 ? (
          <EmptyState icon={matching === 0 ? "vcs" : "search"}>
            {matching === 0 ? "No listings yet." : "No listings match your search or filters."}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((v) => <VcCard key={v.id} vc={v} applied={appliedSet.has(v.id)} onDismiss={() => dismiss(v.id)} />)}
          </div>
        )}
      </div>

      <Pager
        url={url}
        page={filters.page}
        total={matching}
        pageSize={pageSize}
        label="VCs & grants pages"
      />
    </>
  );
}

function VcCard({ vc: v, applied, onDismiss }: {
  vc: Vc;
  applied: boolean;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { checking, stale, check } = useListingFreshness("vcs_grants", v.id);
  const expandRecorded = useRef(false);

  useEffect(() => {
    if (!open) return;
    void check();
    if (!expandRecorded.current) {
      expandRecorded.current = true;
      recordListingEvent("vc_grant", v.id, "expand");
    }
  }, [open, check, v.id]);

  const deadlineLabel = v.deadline
    ? formatDate(v.deadline)
    : null;
  const kindLabel = v.kind === "vc" ? "VC" : "Grant";

  return (
    <Disclosure
      id={`v-${v.id}`}
      size="sm"
      lazy
      open={open}
      onOpenChange={setOpen}
      closedLabel="Show details"
      openLabel="Hide details"
      summary={
        <span className="flex items-start gap-4">
          <Disc size="sm">
            <Icon name="vcs" size={18} />
          </Disc>
          <span className="grid min-w-0 flex-1 gap-1.5">
            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <Badge>{kindLabel}</Badge>
              {deadlineLabel && (
                <span className="data text-small text-text-muted">Deadline {deadlineLabel}</span>
              )}
            </span>
            <span className="block font-display text-lead text-text-primary">{v.name}</span>
            <span className="mt-1 grid gap-2 text-small text-text-secondary">
              <span className="flex items-center gap-2">
                <Avatar name={v.postedBy.firstName} size="xs" tone="lit" />
                <span className="min-w-0">Posted by {v.postedBy.firstName} {v.postedBy.surname}</span>
              </span>
              {(v.amount || v.stage) && (
                <span className="flex items-start gap-2">
                  <Icon name="pound" size={16} className="mt-0.5 shrink-0 text-text-muted" />
                  <span className="min-w-0">{[v.amount, v.stage].filter(Boolean).join(" · ")}</span>
                </span>
              )}
            </span>
          </span>
        </span>
      }
    >
      {stale ? (
        <ListingGoneNotice kind="VC/grant" onDismiss={onDismiss} />
      ) : (
        <div className="grid gap-5 pt-4">
          {checking && <p className="text-small text-text-muted">Loading latest details…</p>}
          <div className="grid gap-1.5">
            <p className="label-wide text-text-muted">Description</p>
            <p className="whitespace-pre-wrap text-body text-text-secondary">{v.description}</p>
          </div>

          <div className="flex flex-wrap items-start gap-3">
            <ExternalButtonLink
              href={v.link}
              onClick={() => recordListingEvent("vc_grant", v.id, "external_click")}
            >
              Open link
            </ExternalButtonLink>
            <MarkActionPill kind="vc_grant" id={v.id} initial={applied} />
            <FullPageLink href={`/vcs/${v.id}`} />
          </div>
        </div>
      )}
    </Disclosure>
  );
}
