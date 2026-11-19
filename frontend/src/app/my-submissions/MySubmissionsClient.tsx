"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteOwnListing, type ListingType } from "./actions";
import { STACK_TRAILING } from "../entryTrailing";
import { formatDate } from "@/lib/dates";
import { ErrorBanner } from "@/components/forms/Banners";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { Entry } from "@/components/ui/Entry";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";

const EDIT_HREF: Record<ListingType, (id: string) => string> = {
  opportunity: (id) => `/opportunities/${id}/edit`,
  event:       (id) => `/events/${id}/edit`,
  vc_grant:    (id) => `/vcs/${id}/edit`,
};

const KIND_ICON: Record<ListingType, IconName> = {
  opportunity: "opportunities",
  event:       "events",
  vc_grant:    "vcs",
};

type Status = "pending" | "approved" | "rejected" | "expired";

type Item = {
  id: string;
  title: string;
  subtitle: string | null;
  status: Status;
  createdAt: string;
  rejectedReason: string | null;
  stats: { views: number; clicks: number };
};

// Four states that must be told apart at a glance in a mixed list: a review
// waiting is lit, a live listing is confirmed, a rejected one is danger and an
// expired one steps back. The word is always on the badge, so colour never
// carries it alone.
const STATUS_TONE: Record<Status, BadgeTone> = {
  pending:  "lit",
  approved: "success",
  rejected: "danger",
  expired:  "neutral",
};

type Props = {
  opportunities: Item[];
  events:        Item[];
  vcs:           Item[];
};

export default function MySubmissionsClient({ opportunities, events, vcs }: Props) {
  const total = opportunities.length + events.length + vcs.length;
  if (total === 0) {
    return (
      <EmptyState icon="submissions">
        Nothing pending or rejected. New submissions will appear here while they wait for admin approval.
      </EmptyState>
    );
  }
  return (
    <div className="lm-sections">
      <ListingSection type="opportunity" label="Opportunities" items={opportunities} />
      <ListingSection type="event"       label="Events"        items={events} />
      <ListingSection type="vc_grant"    label="VCs & grants"  items={vcs} />
    </div>
  );
}

// Keeps a long submissions list compact while every item stays reachable.
// Past 3 rows, by device:
//   • Desktop (lg+): every row, and the page scrolls. (This used to be a box
//     capped at 26rem that scrolled inside the page: 520 of 869 px showed under
//     a heading that said 5, and nothing said there were more.)
//   • Below lg: show 3, then a "Show all" button expands inline, so a phone
//     does not scroll through a tall pile of rows.
// All rows are always in the DOM; rows past the 3rd are hidden below lg via
// CSS until expanded, so the same markup serves both layouts.
function ListingSection({ type, label, items }: { type: ListingType; label: string; items: Item[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const overflowing = items.length > 3;
  const hidden = items.length - 3;
  return (
    <Section
      title={
        <>
          {label} <span className="data text-text-muted">— {items.length}</span>
        </>
      }
    >
      <Panel className="overflow-hidden">
        <div className="divide-y divide-border-subtle">
          {items.map((it, idx) => (
            <div key={it.id} className={overflowing && idx >= 3 && !expanded ? "max-lg:hidden" : ""}>
              <Row type={type} item={it} />
            </div>
          ))}
        </div>
        {overflowing && (
          <div className="border-t border-border-subtle p-1.5 lg:hidden">
            <Button variant="quiet" size="md" className="w-full" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
              {expanded ? "Show less" : `Show all ${items.length} (${hidden} more)`}
              <Icon name="chevron-down" size={16} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            </Button>
          </div>
        )}
      </Panel>
    </Section>
  );
}

function Row({ type, item }: { type: ListingType; item: Item }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const submitted = formatDate(item.createdAt);
  const live = item.status === "approved" || item.status === "expired";

  const handleDelete = () => {
    setError("");
    startTransition(async () => {
      const res = await deleteOwnListing(type, item.id);
      if (!res.ok) { setError(res.error); return; }
      // Server action already revalidates /my-submissions; refresh
      // re-renders the row out without dropping the rest of the UI state.
      router.refresh();
    });
  };

  const actions = (
    <>
      {(item.status === "pending" || item.status === "approved") && (
        <ButtonLink href={EDIT_HREF[type](item.id)} variant="ghost" size="sm">
          {item.status === "approved" ? "Propose a change" : "Edit"}
        </ButtonLink>
      )}
      <Button variant="dangerGhost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
        Delete
      </Button>
    </>
  );

  return (
    // Test id so E2E can scope to one row. Filtering by "a div containing
    // this title" instead matches every ancestor too, which is how the
    // delete-flow locator used to pick up a *different* row's button.
    <div data-testid="submission-row">
      <Entry
        glyph={<Icon name={KIND_ICON[type]} size={20} />}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 break-words">{item.title}</span>
            <Badge tone={STATUS_TONE[item.status]} dot>{item.status}</Badge>
          </span>
        }
        meta={item.subtitle ?? undefined}
        // The actions sit at the row's right, level with its title (STACK_TRAILING drops them under the words on a phone); the confirmation
        // (below) replaces them in the body, away from the button that was pressed, so a double click on Delete cannot land on Confirm.
        trailing={confirming ? undefined : actions}
        className={`items-start rounded-none px-4 py-4 sm:px-5 ${STACK_TRAILING}`}
      >
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-muted">
          <span>Submitted {submitted}</span>
          {live && (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="eye" size={16} />
                {`${item.stats.views} view${item.stats.views === 1 ? "" : "s"}`}
              </span>
              <span className="text-text-muted" aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="pointer" size={16} />
                {`${item.stats.clicks} click${item.stats.clicks === 1 ? "" : "s"}`}
              </span>
            </span>
          )}
        </p>

        {item.status === "rejected" && item.rejectedReason && (
          <p className="mt-3 rounded-lg border border-danger-line bg-danger-muted px-3 py-2 text-small text-danger">
            <span className="font-medium">Reviewer:</span> {item.rejectedReason}
          </p>
        )}

        {confirming && (
          <DeleteConfirm approved={item.status === "approved"} pending={pending} onCancel={() => setConfirming(false)} onConfirm={handleDelete} />
        )}
      </Entry>
      {error && <div className="px-4 pb-4 sm:px-5"><ErrorBanner>{error}</ErrorBanner></div>}
    </div>
  );
}

// The inline confirmation that takes the place of a row's actions. Cancel, then the destructive one: the order of every delete dialog (a
// confirm sits last, at the end of the reading line).
function DeleteConfirm({
  approved, pending, onCancel, onConfirm,
}: { approved: boolean; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="mt-3 grid gap-3">
      {approved && (
        <p className="max-w-prose text-small text-danger">
          This is live in the community directory. Deleting it removes it for everyone, immediately, and is irreversible.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={pending}>
          {pending ? "Deleting…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}
