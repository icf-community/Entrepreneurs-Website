"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUrlFilters, useSearchDraft } from "@/lib/filters/useUrlFilters";
import { SearchInput, FilterPanel, ChipChoice, RangeFilter } from "@/components/filters/FilterBar";
import { useListingFreshness } from "@/lib/useListingFreshness";
import { ListingGoneNotice } from "@/components/ListingGoneNotice";
import { ExternalButtonLink, FullPageLink, OutArrow } from "@/components/FullPageLink";
import { MarkActionPill } from "@/components/MarkActionPill";
import { AddToCalendarMenu } from "@/components/AddToCalendarMenu";
import { recordListingEvent } from "@/lib/analytics";
import { formatDateWeekday, formatTime } from "@/lib/dates";
import type { FoundryEvent } from "@/lib/data/events";
import { externalHref, mailtoHref } from "@/lib/safeUrl";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";

// D1: same cap as OpportunitiesClient — only the first PAGE matches render
// and hydrate; search and filters still cover every event.
const PAGE = 30;

const MODES = [
  { value: "all",       label: "All" },
  { value: "online",    label: "Online" },
  { value: "in_person", label: "In-person" },
] as const;

const MODE_VALUES = MODES.map((m) => m.value);

// Mirrors the auto-detection on the card itself so the filter is a
// pure overlay of the same logic.
const ONLINE_RE = /online|zoom|google meet|teams|lu\.ma|webinar|virtual/i;

export default function EventsClient({
  // react-doctor-disable-next-line react-doctor/rerender-memo-with-default-value -- component is not wrapped in React.memo; rule's premise doesn't apply here
  items, goingIds = [],
}: {
  items: FoundryEvent[];
  /** Event IDs the current user has self-marked as going. */
  goingIds?: string[];
}) {
  // Client-side navigation: list_approved_events already filters to
  // event_at >= now(), so the page holds every event it can show and a
  // filter is a local operation. The URL still owns the state, which is
  // what makes a filtered view shareable.
  const filters = useUrlFilters();
  const [query, setQuery] = useSearchDraft(filters);
  const mode = filters.getOne("mode", MODE_VALUES, "all");
  const from = filters.get("from");
  const to   = filters.get("to");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const goingSet = useMemo(() => new Set(goingIds), [goingIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs   = to   ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const visible = items.filter((e) => !dismissed.has(e.id));
    return visible.filter((e) => {
      const isOnline = ONLINE_RE.test(e.location);
      if (mode === "online"    && !isOnline) return false;
      if (mode === "in_person" &&  isOnline) return false;

      const eventMs = new Date(e.eventAt).getTime();
      if (fromMs != null && eventMs < fromMs) return false;
      if (toMs   != null && eventMs > toMs)   return false;

      if (q) {
        const hay = [
          e.title, e.description, e.location, e.organiserName,
          e.postedBy.firstName, e.postedBy.surname,
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, mode, from, to, dismissed]);

  // The count belongs to the filters it was raised under; changing any of
  // them starts from one page again.
  const view = `${query}|${mode}|${from}|${to}`;
  const [paging, setPaging] = useState({ view, n: PAGE });
  const shown = paging.view === view ? paging.n : PAGE;

  const activeFilterCount = (mode !== "all" ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);

  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));

  return (
    <>
      <SearchInput
        label="Search events"
        placeholder="Search events"
        value={query}
        onChange={setQuery}
      />

      <FilterPanel
        activeCount={activeFilterCount}
        onClear={() => filters.clear("mode", "from", "to")}
        resultCount={
          <>
            {filtered.length} of {items.length}
            <span className="sr-only"> events shown</span>
          </>
        }
      >
        <ChipChoice
          label="Location"
          options={MODES}
          value={mode}
          onChange={(next) => filters.apply({ mode: next === "all" ? null : next })}
        />

        <RangeFilter
          label="Date range"
          type="date"
          from={from}
          to={to}
          fromLabel="Events from date"
          toLabel="Events to date"
          onFromChange={(v) => filters.apply({ from: v })}
          onToChange={(v) => filters.apply({ to: v })}
        />
      </FilterPanel>

      {filtered.length === 0 ? (
        <EmptyState icon={items.length === 0 ? "events" : "search"}>
          {items.length === 0 ? "No upcoming events." : "No events match your search or filters."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          {filtered.slice(0, shown).map((e) => <EventCard key={e.id} ev={e} going={goingSet.has(e.id)} onDismiss={() => dismiss(e.id)} />)}
        </div>
      )}
      {filtered.length > shown && (
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setPaging({ view, n: shown + PAGE })}>
            Show more ({filtered.length - shown} more)
          </Button>
        </div>
      )}
    </>
  );
}

function EventCard({ ev, going, onDismiss }: {
  ev: FoundryEvent;
  going: boolean;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { checking, stale, check } = useListingFreshness("events", ev.id);
  const expandRecorded = useRef(false);

  useEffect(() => {
    if (!open) return;
    void check();
    if (!expandRecorded.current) {
      expandRecorded.current = true;
      recordListingEvent("event", ev.id, "expand");
    }
  }, [open, check, ev.id]);

  const dateLabel = formatDateWeekday(ev.eventAt);
  const timeLabel = formatTime(ev.eventAt);

  const isOnline = ONLINE_RE.test(ev.location);

  return (
    <Disclosure
      id={`e-${ev.id}`}
      tone={ev.isSocietyEvent ? "lit" : "default"}
      size="sm"
      lazy
      open={open}
      onOpenChange={setOpen}
      closedLabel="Show details"
      openLabel="Hide details"
      summary={
        <span className="flex items-start gap-4">
          <Disc size="sm">
            <Icon name="events" size={18} />
          </Disc>
          <span className="grid min-w-0 flex-1 gap-1.5">
            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <span className="data text-small text-accent-light">
                {timeLabel} <span className="text-text-muted">· {dateLabel}</span>
              </span>
              {ev.isSocietyEvent && <Badge tone="lit">Society event</Badge>}
            </span>
            <span className="block font-display text-lead text-text-primary">{ev.title}</span>
            <span className="mt-1 grid gap-2 text-small text-text-secondary">
              <span className="flex items-center gap-2">
                <Avatar name={ev.organiserName} size="xs" tone="lit" />
                <span className="min-w-0">By {ev.organiserName}</span>
              </span>
              <span className="flex items-start gap-2">
                <Icon name={isOnline ? "video" : "pin"} size={16} className="mt-0.5 shrink-0 text-text-muted" />
                <span className="min-w-0">{ev.location}</span>
              </span>
            </span>
          </span>
        </span>
      }
    >
      {stale ? (
        <ListingGoneNotice kind="event" onDismiss={onDismiss} />
      ) : (
        <div className="grid gap-5 pt-4">
          {checking && <p className="text-small text-text-muted">Loading latest details…</p>}
          <div className="grid gap-1.5">
            <p className="label-wide text-text-muted">Description</p>
            <p className="whitespace-pre-wrap text-body text-text-secondary">{ev.description}</p>
          </div>

          <DefinitionList>
            <Definition term="Posted by">
              <span className="grid gap-1">
                <span>{ev.postedBy.firstName} {ev.postedBy.surname}</span>
                {ev.postedBy.linkedinUrl && (
                  <a
                    href={externalHref(ev.postedBy.linkedinUrl)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-small text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent"
                  >
                    LinkedIn
                    <OutArrow />
                  </a>
                )}
              </span>
            </Definition>
            {ev.contactEmail && (
              <Definition term="Contact organiser">
                <a
                  href={mailtoHref(ev.contactEmail, ev.title)}
                  onClick={() => recordListingEvent("event", ev.id, "contact_click")}
                  className="text-text-secondary underline underline-offset-[3px] decoration-border-strong transition-colors hover:text-text-primary hover:decoration-accent"
                >
                  {ev.contactEmail}
                </a>
              </Definition>
            )}
          </DefinitionList>

          <div className="flex flex-wrap items-start gap-3">
            <ExternalButtonLink
              href={ev.lumaLink}
              onClick={() => recordListingEvent("event", ev.id, "external_click")}
            >
              RSVP on Luma
            </ExternalButtonLink>
            <AddToCalendarMenu
              title={ev.title}
              description={ev.description}
              location={ev.location}
              startIso={ev.eventAt}
              url={ev.lumaLink}
            />
            <MarkActionPill kind="event" id={ev.id} initial={going} />
            <FullPageLink href={`/events/${ev.id}`} />
          </div>
        </div>
      )}
    </Disclosure>
  );
}
