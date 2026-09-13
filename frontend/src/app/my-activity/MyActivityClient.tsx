"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { unmarkAction, type ListingKind } from "@/lib/listingActions";
import { formatDate, formatDateTime } from "@/lib/dates";
// Type-only, so the server-only module is erased rather than imported.
import type { ActivityItem } from "@/lib/data/activity";
import { externalHref } from "@/lib/safeUrl";

type Tab = "all" | "opportunity" | "event" | "vc_grant";

const TAB_LABEL: Record<Tab, string> = {
  all:          "All",
  opportunity:  "Applied — opportunities",
  event:        "Going — events",
  vc_grant:     "Applied — VCs & grants",
};

const KIND_BADGE: Record<ListingKind, string> = {
  opportunity:  "Opportunity",
  event:        "Event",
  vc_grant:     "VC / grant",
};

export default function MyActivityClient({ items }: { items: ActivityItem[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const key = (i: ActivityItem) => `${i.listingKind}:${i.listingId}`;
  const visible = useMemo(() => {
    return items.filter((i) => !removed.has(key(i)) && (tab === "all" || i.listingKind === tab));
  }, [items, removed, tab]);

  const counts = useMemo(() => ({
    all:          items.filter((i) => !removed.has(key(i))).length,
    opportunity:  items.filter((i) => !removed.has(key(i)) && i.listingKind === "opportunity").length,
    event:        items.filter((i) => !removed.has(key(i)) && i.listingKind === "event").length,
    vc_grant:     items.filter((i) => !removed.has(key(i)) && i.listingKind === "vc_grant").length,
  }), [items, removed]);

  const handleUnmark = async (i: ActivityItem) => {
    const k = key(i);
    setRemoved((prev) => new Set(prev).add(k));
    const res = await unmarkAction(i.listingKind, i.listingId);
    if (!res.ok) {
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
    }
  };

  if (items.length === 0 || counts.all === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-[0.85rem] text-text-muted">
        Nothing here yet. When you apply to an opportunity or VC, or RSVP to an event, hit the &quot;Mark as applied&quot; / &quot;Mark as going&quot; button on the listing — it&apos;ll show up here.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5 mb-6">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-[0.775rem] border transition-colors cursor-pointer ${
              tab === t
                ? "bg-accent-muted border-accent/50 text-accent-light"
                : "bg-white/[0.02] border-border text-text-secondary hover:border-accent hover:text-text-primary"
            }`}
          >
            {TAB_LABEL[t]} <span className="opacity-60">· {counts[t]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-[0.85rem] text-text-muted">
          Nothing in this tab.
        </div>
      ) : (
        <div className="rounded-2xl bg-bg-card border border-border divide-y divide-border-subtle">
          {visible.map((i) => <Row key={key(i)} item={i} onUnmark={() => handleUnmark(i)} />)}
        </div>
      )}
    </>
  );
}

function Row({ item, onUnmark }: { item: ActivityItem; onUnmark: () => void }) {
  const occursLabel = item.occursAt
    ? formatOccurs(item.listingKind, item.occursAt)
    : null;
  const markedLabel = formatDate(item.markedAt);

  // Straight to the listing's own page. An expired one resolves to that
  // page's "no longer listed" body, which is the honest answer for a row
  // this list has already badged as expired — and better than the old link
  // to the whole directory, which made the reader hunt for a listing that
  // is no longer in it.
  const section =
    item.listingKind === "opportunity" ? "/opportunities" :
    item.listingKind === "event"       ? "/events"        :
                                         "/vcs";
  const internalHref = `${section}/${item.listingId}`;

  const expired = item.status === "expired";

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-lg text-[0.65rem] uppercase tracking-wider border bg-white/[0.02] border-border text-text-muted">
              {KIND_BADGE[item.listingKind]}
            </span>
            <span className="px-2 py-0.5 rounded-lg text-[0.65rem] uppercase tracking-wider border bg-accent-muted text-accent-light border-accent/30">
              {item.actionType === "going" ? "Going" : "Applied"}
            </span>
            {expired && (
              <span className="px-2 py-0.5 rounded-lg text-[0.65rem] uppercase tracking-wider border bg-white/[0.02] border-border-subtle text-text-muted/70">
                Listing expired
              </span>
            )}
          </div>
          <Link
            href={internalHref}
            className="block mt-2 text-[0.95rem] text-text-primary no-underline hover:text-accent-light transition-colors"
          >
            {item.title}
          </Link>
          {item.subtitle && (
            <div className="text-[0.75rem] text-text-muted mt-0.5">{item.subtitle}</div>
          )}
          <div className="text-[0.7rem] text-text-muted mt-2 flex items-center gap-3 flex-wrap">
            {occursLabel && <span>{occursLabel}</span>}
            <span>Marked {markedLabel}</span>
          </div>
        </div>
        <div className="shrink-0 flex items-start gap-1.5">
          {item.url && (
            <a
              href={externalHref(item.url)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-transparent border border-border text-text-secondary text-[0.75rem] no-underline transition-colors hover:border-accent hover:text-accent-light"
            >
              Open ↗
            </a>
          )}
          <button
            type="button"
            onClick={onUnmark}
            className="px-3 py-1.5 rounded-lg bg-white/[0.05] border border-border-strong text-text-secondary text-[0.75rem] cursor-pointer transition-colors hover:bg-[#ff4d4d]/10 hover:border-[#ff4d4d]/50 hover:text-[#ff8b8b]"
          >
            Unmark
          </button>
        </div>
      </div>
    </div>
  );
}

function formatOccurs(kind: ListingKind, iso: string): string {
  if (kind === "event") {
    return formatDateTime(iso);
  }
  return `Deadline ${formatDate(iso)}`;
}
