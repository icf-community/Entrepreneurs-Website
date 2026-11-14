"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Dialog, DialogClose } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Entry } from "@/components/ui/Entry";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { ButtonTabs } from "@/components/ui/Tabs";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";
import { externalHref } from "@/lib/safeUrl";
import {
  dayKey,
  londonDayKey,
  formatDayKeyLong,
  formatDateLong,
  formatDateTimeLong,
  formatMonthYear,
  formatTime,
} from "@/lib/dates";

type ListingKind = "opportunity" | "event" | "vc_grant";
type Role = "applied" | "going" | "organising" | "posted";
type Status = "pending" | "approved";

export type MetaRow = { label: string; value: string; href?: string };

export type CalItem = {
  listingKind: ListingKind;
  listingId:   string;
  title:       string;
  subtitle:    string | null;
  occursAt:    string;
  role:        Role;
  status:      Status;
  description: string | null;
  meta:        MetaRow[];
};

type View = "list" | "month";

/** Where each kind's own page lives, for the dialog's link through. */
const SECTION: Record<ListingKind, string> = {
  opportunity: "/opportunities",
  event:       "/events",
  vc_grant:    "/vcs",
};

// A kind is told by its drawing (and, everywhere it is named, by its words), not by a hue:
// the lit day is the only lit thing on the page.
const KIND_ICON: Record<ListingKind, IconName> = {
  opportunity:  "opportunities",
  event:        "events",
  vc_grant:     "vcs",
};

const KIND_LABEL: Record<ListingKind, string> = {
  opportunity:  "Opportunity deadline",
  event:        "Event",
  vc_grant:     "VC / grant deadline",
};

const ROLE_LABEL: Record<Role, string> = {
  organising: "Organising",
  posted:     "Your listing",
  going:      "Going",
  applied:    "Applied",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarClient({ items }: { items: CalItem[] }) {
  const [view, setView] = useState<View>("month");
  const [selected, setSelected] = useState<CalItem | null>(null);
  // Capture "now" once at mount so re-renders don't change the cutoff
  // and React's purity rule isn't violated by calling Date.now() in
  // the render body.
  const [now] = useState<number>(() => Date.now());

  const upcoming = useMemo(() => {
    return items
      .filter((i) => new Date(i.occursAt).getTime() >= now - 12 * 60 * 60 * 1000) // include today
      .sort((a, b) => new Date(a.occursAt).getTime() - new Date(b.occursAt).getTime());
  }, [items, now]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <ButtonTabs<View>
          variant="segmented"
          size="sm"
          items={[
            { value: "list", label: "List" },
            { value: "month", label: "Month" },
          ]}
          value={view}
          onSelect={setView}
        />
        <span className="data text-body text-text-muted">
          {upcoming.length} upcoming
        </span>
      </div>

      <LegendRow />

      {/* Each view owns its own empty state now — previously a single
          shared message replaced BOTH views whenever upcoming was empty,
          so switching List/Month tabs looked like it did nothing. */}
      {view === "list" ? (
        <ListView items={upcoming} onSelect={setSelected} />
      ) : (
        <MonthView items={upcoming} onSelect={setSelected} />
      )}

      {selected && <DetailDialog item={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function LegendRow() {
  return (
    <ul className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-small text-text-muted">
      <LegendMark kind="event"       label="Event" />
      <LegendMark kind="opportunity" label="Opportunity deadline" />
      <LegendMark kind="vc_grant"    label="VC / grant deadline" />
    </ul>
  );
}

function LegendMark({ kind, label }: { kind: ListingKind; label: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <Icon name={KIND_ICON[kind]} size={16} className="text-text-secondary" />
      {label}
    </li>
  );
}

// ─── List view ─────────────────────────────────────────────────────
function ListView({ items, onSelect }: { items: CalItem[]; onSelect: (i: CalItem) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const i of items) {
      // London calendar day, not UTC. toISOString() bucketed a 00:30 London
      // event under the previous day, so the row sat under a heading it
      // contradicted.
      const key = londonDayKey(i.occursAt);
      const list = map.get(key) ?? [];
      list.push(i);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([dateKey, rows]) => ({ dateKey, rows }));
  }, [items]);

  if (groups.length === 0) {
    return (
      <EmptyState icon="calendar">
        Nothing upcoming. Items you post or mark as going/applied show up here automatically.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-8">
      {groups.map((g) => {
        const dateLabel = formatDayKeyLong(g.dateKey);
        return (
          <section key={g.dateKey} className="grid gap-3">
            <h2 className="font-display text-lead text-text-primary">{dateLabel}</h2>
            <Panel className="p-1.5">
              <ul className="grid gap-0.5">
                {g.rows.map((r) => <ListRow key={`${r.listingKind}:${r.listingId}`} item={r} onSelect={onSelect} />)}
              </ul>
            </Panel>
          </section>
        );
      })}
    </div>
  );
}

function ListRow({ item, onSelect }: { item: CalItem; onSelect: (i: CalItem) => void }) {
  const timeLabel = item.listingKind === "event" ? formatTime(item.occursAt) : "Deadline";
  return (
    <Entry
      as="li"
      glyph={<Icon name={KIND_ICON[item.listingKind]} size={20} />}
      // The whole row is the button, as the stretched link of any other Entry: one control in the
      // accessibility tree, opening the item's details.
      title={
        <button
          type="button"
          onClick={() => onSelect(item)}
          className="cursor-pointer border-0 bg-transparent p-0 text-left text-inherit after:absolute after:inset-0 after:content-['']"
        >
          {item.title}
        </button>
      }
      meta={
        <>
          <span className="data">{timeLabel}</span> <span className="text-text-muted">· {KIND_LABEL[item.listingKind]}</span>
        </>
      }
      trailing={
        <>
          {item.status === "pending" && <Badge tone="lit">In review</Badge>}
          <Badge>{ROLE_LABEL[item.role]}</Badge>
        </>
      }
    >
      {item.subtitle && <p className="mt-0.5 text-small text-text-muted">{item.subtitle}</p>}
    </Entry>
  );
}

// ─── Month view ────────────────────────────────────────────────────
// Renders the month containing the first upcoming item. Prev / next
// month nav stays inside the same client component — no router round-
// trips needed since the items array is already paginated client-side.
//
// The one place a dense table is right: drawn with hairlines (a 1 px gap over a
// rule colour), the days of the month on the card, the days of its neighbours a
// step darker, and today as a lit ring: the only lit thing on the page.
function MonthView({ items, onSelect }: { items: CalItem[]; onSelect: (i: CalItem) => void }) {
  // The cursor is a London year/month, not a Date. A Date here would be a
  // local-midnight one, and local midnight on the 1st is the previous month
  // in any zone ahead of London — so the heading and the grid would name
  // different months on a visitor's machine in Sydney.
  //
  // Falls back to the current month when there's nothing upcoming — items[0]
  // used to be read unconditionally, which crashed the moment this view
  // rendered with an empty list instead of showing an empty grid for "now".
  const [cursor, setCursor] = useState<MonthCursor>(() =>
    monthOf(items[0]?.occursAt ?? new Date().toISOString()));

  const monthLabel = formatMonthYear(cursor.year, cursor.month);
  const grid = useMemo(() => buildMonthGrid(cursor, items), [cursor, items]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setCursor((c) => shiftMonth(c, -1))}
          className="lm-iconbtn"
          aria-label="Previous month"
        >
          <Icon name="chevron-left" size={20} />
        </button>
        <div aria-live="polite" className="min-w-0 flex-1 text-center font-display text-title text-text-primary sm:min-w-[11rem] sm:flex-none">{monthLabel}</div>
        <button
          type="button"
          onClick={() => setCursor((c) => shiftMonth(c, 1))}
          className="lm-iconbtn"
          aria-label="Next month"
        >
          <Icon name="chevron-right" size={20} />
        </button>
      </div>

      <Panel className="overflow-hidden">
        <div className="grid grid-cols-7 gap-px bg-border-subtle text-small">
          {WEEKDAYS.map((d) => (
            <div key={d} className="wrap-normal bg-bg-secondary px-1.5 py-2.5 text-caption font-medium text-text-muted sm:px-2">{d}</div>
          ))}
          {grid.map((cell) => (
            <div
              key={cell.key}
              // Out-of-month days sit a step darker than the card rather than at reduced
              // opacity: opacity-40 took their dates to 1.8:1 contrast (D4).
              className={`min-h-20 p-1 sm:min-h-24 sm:p-2 ${cell.inMonth ? "bg-bg-card" : "bg-bg-secondary"}`}
            >
              <div className="mb-1">
                {cell.isToday ? (
                  <span
                    aria-current="date"
                    className="data inline-flex size-7 items-center justify-center rounded-full border border-lit-line bg-lit-muted text-small font-medium text-accent-light shadow-[0_0_14px_-3px_var(--color-lit-glow)]"
                  >
                    {cell.day}
                  </span>
                ) : (
                  <span className="data inline-flex h-7 items-center px-1 text-small text-text-muted">{cell.day}</span>
                )}
              </div>
              <div className="grid gap-0.5">
                {cell.items.map((i) => (
                  <button
                    key={`${i.listingKind}:${i.listingId}`}
                    type="button"
                    onClick={() => onSelect(i)}
                    title={i.title}
                    className="flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-left text-text-secondary transition-colors hover:bg-tint-3 hover:text-text-primary"
                  >
                    <Icon name={KIND_ICON[i.listingKind]} size={14} className="shrink-0 text-text-muted" />
                    {/* On a phone a day is a column about as wide as a finger: the mark alone, the title stays for a screen reader. */}
                    <span className="truncate text-caption max-sm:sr-only">{i.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {items.length === 0 && (
        <p className="mt-4 text-center text-body text-text-muted">
          Nothing upcoming. Items you post or mark as going/applied show up here automatically.
        </p>
      )}
    </div>
  );
}

// ─── Detail dialog ─────────────────────────────────────────────────
function DetailDialog({ item, onClose }: { item: CalItem; onClose: () => void }) {
  const when = item.listingKind === "event"
    ? formatDateTimeLong(item.occursAt)
    : `Deadline · ${formatDateLong(item.occursAt)}`;

  return (
    <Dialog
      onClose={onClose}
      label={item.title}
      containerClassName="flex items-end sm:items-center justify-center p-0 sm:p-4"
      className="max-h-[88vh] w-full overflow-y-auto overscroll-contain p-6 max-sm:rounded-b-none sm:max-w-[34rem] sm:p-7"
    >
      <DialogClose className="absolute right-4 top-4 z-10" />

      <div className="mb-5 min-w-0 pr-12">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-text-muted">
          <Icon name={KIND_ICON[item.listingKind]} size={16} className="text-text-secondary" />
          {KIND_LABEL[item.listingKind]}
          <span aria-hidden>·</span>
          <span>{ROLE_LABEL[item.role]}</span>
        </div>
        <h2 className="mt-2 font-display text-heading text-text-primary">{item.title}</h2>
        {item.subtitle && <p className="mt-1 text-body text-text-muted">{item.subtitle}</p>}
      </div>

      <div className="grid gap-5">
        {item.status === "pending" && (
          <Notice tone="lit" title="Still in review.">
            This listing is awaiting admin approval, so it doesn&apos;t have a public page yet. The details below are what you submitted.
          </Notice>
        )}

        <p className="data text-body text-text-primary">{when}</p>

        {item.meta.length > 0 && (
          <DefinitionList layout="inline">
            {item.meta.map((m) => (
              <Definition key={m.label} term={m.label}>
                {m.href ? (
                  <a
                    href={externalHref(m.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-accent-light underline underline-offset-4"
                  >
                    {m.value}
                  </a>
                ) : (
                  m.value
                )}
              </Definition>
            ))}
          </DefinitionList>
        )}

        {item.description && (
          <section className="grid gap-2 border-t border-border-subtle pt-5">
            <div className="label-wide text-text-muted">Description</div>
            <p className="whitespace-pre-line text-body text-text-secondary">{item.description}</p>
          </section>
        )}

        {/* Only for approved listings: a pending one has no page yet, which
            the notice above already says. */}
        {item.status === "approved" && (
          <ButtonLink href={`${SECTION[item.listingKind]}/${item.listingId}`} variant="ghost" size="md" className="justify-self-start">
            Open full page<span className="sr-only"> →</span>
            <Icon name="arrow-right" size={16} />
          </ButtonLink>
        )}
      </div>
    </Dialog>
  );
}

type MonthCell = { key: string; day: number; inMonth: boolean; isToday: boolean; items: CalItem[] };

/** A calendar month. `month` is 1-12, matching the day keys in lib/dates. */
type MonthCursor = { year: number; month: number };

/** The London month an instant falls in. */
function monthOf(occursAt: string): MonthCursor {
  const [year, month] = londonDayKey(occursAt).split("-").map(Number);
  return { year, month };
}

/** Months are counted, not date-arithmetic'd, so December can't wrap wrong. */
function shiftMonth({ year, month }: MonthCursor, delta: number): MonthCursor {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function buildMonthGrid(cursor: MonthCursor, items: CalItem[]): MonthCell[] {
  const { year, month } = cursor;
  // Pure calendar arithmetic, done in UTC so no runtime zone can shift it.
  // Day 0 of a month is the last day of the one before it.
  const daysInMonth     = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prevMonthDays   = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  // ISO week starts Monday. getUTCDay: 0=Sun,...6=Sat. Convert to 0=Mon.
  const startWeekday    = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  // London calendar day — the grid never marked "today" on any cell, even
  // when the current month was on screen.
  const todayKey = londonDayKey(new Date().toISOString());

  // Keyed by London calendar day — the same key the list view groups on, so
  // the two views cannot disagree about which day a row belongs to.
  const byDate = new Map<string, CalItem[]>();
  for (const i of items) {
    const key = londonDayKey(i.occursAt);
    const list = byDate.get(key) ?? [];
    list.push(i);
    byDate.set(key, list);
  }

  // Padding cells borrow days from the adjacent month, so their key is
  // that month's actual calendar date (via shiftMonth, which handles the
  // December/January wrap) — not the grid position, which an index key
  // would amount to and which stops being unique the moment a leading and
  // a trailing pad cell land on the same day-of-month number.
  const prevCursor = shiftMonth(cursor, -1);
  const nextCursor = shiftMonth(cursor, 1);

  const cells: MonthCell[] = [];
  for (let i = 0; i < startWeekday; i++) {
    const day = prevMonthDays - startWeekday + 1 + i;
    cells.push({ key: dayKey(prevCursor.year, prevCursor.month, day), day, inMonth: false, isToday: false, items: [] });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dayKey(year, month, d);
    cells.push({ key, day: d, inMonth: true, isToday: key === todayKey, items: byDate.get(key) ?? [] });
  }
  // Fill out to a multiple of 7.
  while (cells.length % 7 !== 0) {
    const day = cells.length - (startWeekday + daysInMonth) + 1;
    cells.push({ key: dayKey(nextCursor.year, nextCursor.month, day), day, inMonth: false, isToday: false, items: [] });
  }
  return cells;
}
