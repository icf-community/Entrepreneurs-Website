"use client";

import { useMemo, useState } from "react";
import { unmarkAction, type ListingKind } from "@/lib/listingActions";
import { formatDate, formatDateTime } from "@/lib/dates";
// Type-only, so the server-only module is erased rather than imported.
import type { ActivityItem } from "@/lib/data/activity";
import { externalHref } from "@/lib/safeUrl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { Entry } from "@/components/ui/Entry";
import { Panel } from "@/components/ui/Panel";
import { ButtonTabs, TabCount } from "@/components/ui/Tabs";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";

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

const KIND_ICON: Record<ListingKind, IconName> = {
  opportunity:  "opportunities",
  event:        "events",
  vc_grant:     "vcs",
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
      <EmptyState icon="activity">
        Nothing here yet. When you apply to an opportunity or VC, or RSVP to an event, hit the &quot;Mark as applied&quot; / &quot;Mark as going&quot; button on the listing — it&apos;ll show up here.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-6">
      {/* A toggle between views of this page, so each tab says whether it is pressed (the count stays in its name). */}
      <ButtonTabs<Tab>
        items={(Object.keys(TAB_LABEL) as Tab[]).map((t) => ({
          value: t,
          label: (
            <>
              {TAB_LABEL[t]} <TabCount>· {counts[t]}</TabCount>
            </>
          ),
        }))}
        value={tab}
        onSelect={setTab}
      />

      {visible.length === 0 ? (
        <EmptyState icon="activity" size="compact">
          Nothing in this tab.
        </EmptyState>
      ) : (
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-border-subtle">
            {visible.map((i) => <Row key={key(i)} item={i} onUnmark={() => handleUnmark(i)} />)}
          </ul>
        </Panel>
      )}
    </div>
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
  // Only an http(s) address becomes a link (lib/safeUrl); anything else draws no control.
  const openHref = externalHref(item.url);

  return (
    <Entry
      as="li"
      glyph={<Icon name={KIND_ICON[item.listingKind]} size={20} />}
      title={item.title}
      href={internalHref}
      meta={item.subtitle ?? undefined}
      className="items-start rounded-none px-4 py-4 sm:px-5"
    >
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge>{KIND_BADGE[item.listingKind]}</Badge>
        <Badge tone="lit">{item.actionType === "going" ? "Going" : "Applied"}</Badge>
        {expired && <Badge>Listing expired</Badge>}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-muted">
        {occursLabel && <span className="data">{occursLabel}</span>}
        <span>Marked <span className="data">{markedLabel}</span></span>
      </p>
      {/* The controls sit above the row's stretched link (z-10), so they stay clickable. */}
      <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
        {openHref && (
          <ButtonLink
            href={openHref}
            target="_blank"
            rel="noreferrer noopener"
            variant="ghost"
            size="sm"
          >
            Open<span className="sr-only"> ↗</span>
            <Icon name="arrow-up-right" size={16} />
          </ButtonLink>
        )}
        <Button variant="dangerGhost" size="sm" onClick={onUnmark}>
          Unmark
        </Button>
      </div>
    </Entry>
  );
}

function formatOccurs(kind: ListingKind, iso: string): string {
  if (kind === "event") {
    return formatDateTime(iso);
  }
  return `Deadline ${formatDate(iso)}`;
}
