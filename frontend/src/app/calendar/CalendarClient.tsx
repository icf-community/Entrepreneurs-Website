"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Dialog, closeDialog } from "@/components/ui/Dialog";
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

const KIND_DOT: Record<ListingKind, string> = {
  opportunity:  "bg-accent",
  event:        "bg-[#7fb3ff]",
  vc_grant:     "bg-[#b6e08b]",
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
      <div className="flex items-center gap-1.5 mb-6">
        <ViewTab label="List"  active={view === "list"}  onClick={() => setView("list")} />
        <ViewTab label="Month" active={view === "month"} onClick={() => setView("month")} />
        <span className="ml-auto text-[0.8rem] text-text-muted">
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

function ViewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-[0.775rem] border transition-colors cursor-pointer ${
        active
          ? "bg-accent-muted border-accent/50 text-accent-light"
          : "bg-white/[0.02] border-border text-text-secondary hover:border-accent hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}

function LegendRow() {
  return (
    <div className="flex items-center gap-3 mb-4 text-[0.7rem] text-text-muted flex-wrap">
      <LegendDot kind="event"       label="Event" />
      <LegendDot kind="opportunity" label="Opportunity deadline" />
      <LegendDot kind="vc_grant"    label="VC / grant deadline" />
    </div>
  );
}

function LegendDot({ kind, label }: { kind: ListingKind; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${KIND_DOT[kind]}`} aria-hidden />
      {label}
    </span>
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
      <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-[0.85rem] text-text-muted">
        Nothing upcoming. Items you post or mark as going/applied show up here automatically.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const dateLabel = formatDayKeyLong(g.dateKey);
        return (
          <section key={g.dateKey}>
            <h2 className="text-[0.85rem] text-accent-light mb-2">{dateLabel}</h2>
            <div className="rounded-2xl bg-bg-card border border-border divide-y divide-border-subtle">
              {g.rows.map((r) => <ListRow key={`${r.listingKind}:${r.listingId}`} item={r} onSelect={onSelect} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ListRow({ item, onSelect }: { item: CalItem; onSelect: (i: CalItem) => void }) {
  const timeLabel = item.listingKind === "event" ? formatTime(item.occursAt) : "Deadline";
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="w-full flex items-start gap-3 p-4 text-left bg-transparent border-0 cursor-pointer transition-colors hover:bg-white/[0.02]"
    >
      <span className={`mt-1.5 shrink-0 inline-block w-2 h-2 rounded-full ${KIND_DOT[item.listingKind]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[0.7rem] text-text-muted">
          {timeLabel} <span className="opacity-60">· {KIND_LABEL[item.listingKind]}</span>
        </div>
        <div className="text-[0.9rem] text-text-primary mt-0.5">{item.title}</div>
        {item.subtitle && <div className="text-[0.75rem] text-text-muted mt-0.5">{item.subtitle}</div>}
      </div>
      <span className="shrink-0 flex items-center gap-1.5">
        {item.status === "pending" && (
          <span className="px-2 py-0.5 rounded-lg text-[0.6rem] uppercase tracking-wider border border-border text-text-muted">
            In review
          </span>
        )}
        <span className="px-2 py-0.5 rounded-lg text-[0.65rem] tracking-wide border border-border-subtle text-text-muted">
          {ROLE_LABEL[item.role]}
        </span>
      </span>
    </button>
  );
}

// ─── Month view ────────────────────────────────────────────────────
// Renders the month containing the first upcoming item. Prev / next
// month nav stays inside the same client component — no router round-
// trips needed since the items array is already paginated client-side.
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
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setCursor((c) => shiftMonth(c, -1))}
          className="px-3 py-1.5 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary text-[0.8rem] cursor-pointer transition-colors hover:bg-white/[0.10] hover:border-accent hover:text-accent-light"
          aria-label="Previous month"
        >
          ◀
        </button>
        <div className="px-3 py-1.5 text-[0.9rem] text-text-primary">{monthLabel}</div>
        <button
          type="button"
          onClick={() => setCursor((c) => shiftMonth(c, 1))}
          className="px-3 py-1.5 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary text-[0.8rem] cursor-pointer transition-colors hover:bg-white/[0.10] hover:border-accent hover:text-accent-light"
          aria-label="Next month"
        >
          ▶
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border-subtle border border-border-subtle rounded-2xl overflow-hidden text-[0.7rem]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-2 bg-bg-card text-text-muted uppercase tracking-wider">{d}</div>
        ))}
        {grid.map((cell, idx) => (
          <div
            key={idx}
            className={`min-h-[88px] p-2 bg-bg-card ${cell.inMonth ? "" : "opacity-40"}`}
          >
            <div
              className={
                cell.isToday
                  ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[0.7rem] font-medium text-bg-primary mb-1"
                  : "text-[0.7rem] text-text-muted mb-1"
              }
            >
              {cell.day}
            </div>
            <div className="space-y-1">
              {cell.items.map((i) => (
                <button
                  key={`${i.listingKind}:${i.listingId}`}
                  type="button"
                  onClick={() => onSelect(i)}
                  title={i.title}
                  className="w-full flex items-center gap-1.5 bg-transparent border-0 p-0 text-left cursor-pointer transition-colors hover:opacity-80"
                >
                  <span className={`shrink-0 inline-block w-1.5 h-1.5 rounded-full ${KIND_DOT[i.listingKind]}`} aria-hidden />
                  <span className="truncate text-[0.7rem] text-text-secondary">{i.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <p className="mt-4 text-center text-[0.8rem] text-text-muted">
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
      className="w-full sm:max-w-[520px] max-h-[88vh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl bg-bg-card border border-border p-6 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[0.7rem] text-text-muted">
            <span className={`inline-block w-2 h-2 rounded-full ${KIND_DOT[item.listingKind]}`} aria-hidden />
            {KIND_LABEL[item.listingKind]}
            <span className="opacity-50">·</span>
            <span>{ROLE_LABEL[item.role]}</span>
          </div>
          <h2 className="font-display text-text-primary text-[1.4rem] leading-tight mt-1">{item.title}</h2>
          {item.subtitle && <div className="text-[0.8rem] text-text-muted mt-1">{item.subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={closeDialog}
          aria-label="Close"
          className="shrink-0 w-11 h-11 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary cursor-pointer hover:bg-white/[0.10] hover:border-accent transition-colors flex items-center justify-center text-lg leading-none"
        >
          ×
        </button>
      </div>

      {item.status === "pending" && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-accent/25 bg-accent/[0.06] text-[0.8rem] text-text-secondary leading-relaxed">
          <span className="text-accent-light font-medium">Still in review.</span> This listing is awaiting admin approval, so it doesn&apos;t have a public page yet. The details below are what you submitted.
        </div>
      )}

      <div className="text-[0.85rem] text-text-primary mb-4">{when}</div>

      {item.meta.length > 0 && (
        <dl className="space-y-2.5 mb-4">
          {item.meta.map((m) => (
            <div key={m.label} className="flex gap-3 text-[0.825rem]">
              <dt className="shrink-0 w-28 text-text-muted">{m.label}</dt>
              <dd className="min-w-0 flex-1 text-text-secondary break-words">
                {m.href ? (
                  <a href={externalHref(m.href)} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:underline break-all">{m.value}</a>
                ) : (
                  m.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {item.description && (
        <div className="pt-3 border-t border-border-subtle">
          <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-2">Description</div>
          <p className="text-[0.85rem] text-text-secondary leading-relaxed whitespace-pre-line">{item.description}</p>
        </div>
      )}

      {/* Only for approved listings: a pending one has no page yet, which
          the banner above already says. */}
      {item.status === "approved" && (
        <Link
          href={`${SECTION[item.listingKind]}/${item.listingId}`}
          className="mt-5 inline-flex items-center rounded-lg border border-border-strong bg-white/[0.05] px-4 py-2 text-[0.8rem] text-text-primary no-underline transition-colors hover:bg-white/[0.10] hover:border-accent"
        >
          Open full page →
        </Link>
      )}
    </Dialog>
  );
}

type MonthCell = { day: number; inMonth: boolean; isToday: boolean; items: CalItem[] };

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

  const cells: MonthCell[] = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ day: prevMonthDays - startWeekday + 1 + i, inMonth: false, isToday: false, items: [] });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dayKey(year, month, d);
    cells.push({ day: d, inMonth: true, isToday: key === todayKey, items: byDate.get(key) ?? [] });
  }
  // Fill out to a multiple of 7.
  while (cells.length % 7 !== 0) {
    const day = cells.length - (startWeekday + daysInMonth) + 1;
    cells.push({ day, inMonth: false, isToday: false, items: [] });
  }
  return cells;
}
