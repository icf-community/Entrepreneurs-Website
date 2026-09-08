"use client";

import { useEffect, useRef, useState } from "react";
import { useUrlFilters, useSearchDraft } from "@/lib/filters/useUrlFilters";
import { SearchInput, FilterPanel, ChipChoice, RangeFilter } from "@/components/filters/FilterBar";
import { Pager } from "@/components/ui/Pager";
import { useListingFreshness } from "@/lib/useListingFreshness";
import { ListingGoneNotice } from "@/components/ListingGoneNotice";
import { FullPageLink } from "@/components/FullPageLink";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import { formatDate } from "@/lib/dates";
import type { Vc, VcFilters } from "@/lib/data/vcs";
import { externalHref } from "@/lib/safeUrl";

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
      <div className={url.pending ? "opacity-60 transition-opacity duration-150" : undefined}>
        {visible.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-[0.85rem] text-text-muted">
            {matching === 0 ? "No listings yet." : "No listings match your search or filters."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
    <article id={`v-${v.id}`} className="rounded-2xl bg-bg-card border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-4 text-left bg-transparent border-0 cursor-pointer transition-colors duration-150 hover:bg-white/[0.02]"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="px-2 py-0.5 rounded-lg text-[0.65rem] uppercase tracking-wider bg-accent-muted text-accent-light border border-accent/20">
            {kindLabel}
          </span>
          {deadlineLabel && (
            <span className="text-[0.7rem] text-text-muted">
              Deadline {deadlineLabel}
            </span>
          )}
        </div>
        <h3 className="text-[1.05rem] font-medium text-text-primary leading-snug mb-3">
          {v.name}
        </h3>
        <div className="space-y-1.5">
          <Meta icon={<PosterAvatar name={v.postedBy.firstName} />} text={`Posted by ${v.postedBy.firstName} ${v.postedBy.surname}`} />
          {(v.amount || v.stage) && (
            <Meta
              icon={<DollarIcon />}
              text={[v.amount, v.stage].filter(Boolean).join(" · ")}
            />
          )}
        </div>
        <div className="mt-3 text-[0.7rem] text-text-muted">
          {open ? "▾ Hide details" : "▸ Show details"}
        </div>
      </button>

      {open && stale && (
        <ListingGoneNotice kind="VC/grant" onDismiss={onDismiss} />
      )}

      {open && !stale && (
        <div className="px-5 pb-5 pt-1 border-t border-border-subtle">
          {checking && (
            <div className="text-[0.7rem] text-text-muted mt-3">Loading latest details…</div>
          )}
          <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-1 mt-4">Description</div>
          <p className="text-[0.85rem] text-text-secondary leading-relaxed whitespace-pre-wrap">{v.description}</p>

          <div className="mt-5 flex items-start gap-2 flex-wrap">
            <a
              href={externalHref(v.link)}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => recordListingEvent("vc_grant", v.id, "external_click")}
              className="inline-block px-4 py-2 rounded-lg bg-accent text-bg-primary text-[0.825rem] font-medium no-underline transition-colors hover:bg-accent-light"
            >
              Open link ↗
            </a>
            <MarkActionPill kind="vc_grant" id={v.id} initial={applied} />
            <FullPageLink href={`/vcs/${v.id}`} />
          </div>
        </div>
      )}
    </article>
  );
}

function Meta({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-[0.8rem] text-text-secondary">
      <span className="shrink-0 text-text-muted">{icon}</span>
      <span className="truncate">{text}</span>
    </div>
  );
}

function PosterAvatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent-muted text-accent-light text-[0.65rem] font-medium border border-accent/25">
      {initial}
    </span>
  );
}

function DollarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
