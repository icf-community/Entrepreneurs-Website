"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteOwnListing, type ListingType } from "./actions";
import { formatDate } from "@/lib/dates";
import { ErrorBanner } from "@/components/forms/Banners";

const EDIT_HREF: Record<ListingType, (id: string) => string> = {
  opportunity: (id) => `/opportunities/${id}/edit`,
  event:       (id) => `/events/${id}/edit`,
  vc_grant:    (id) => `/vcs/${id}/edit`,
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

// Four states that must be told apart at a glance in a mixed list. This is
// the one place --color-signal (the retired gold) still earns its keep: it
// marks "approved" without reading as an action, which a white fill would.
const STATUS_BADGE: Record<Status, string> = {
  pending:  "bg-white/[0.04] text-text-secondary border-border-strong",
  approved: "bg-signal-muted text-signal border-signal/40",
  rejected: "bg-[#ff4d4d]/10 text-[#ff8b8b] border-[#ff4d4d]/30",
  expired:  "bg-white/[0.02] text-text-muted border-border",
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
      <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-[0.85rem] text-text-muted">
        Nothing pending or rejected. New submissions will appear here while they wait for admin approval.
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <Section type="opportunity" label="Opportunities" items={opportunities} />
      <Section type="event"       label="Events"        items={events} />
      <Section type="vc_grant"    label="VCs & grants"  items={vcs} />
    </div>
  );
}

// Keeps a long submissions list compact while every item stays reachable.
// Two patterns by device, both kicking in only past 3 rows:
//   • Desktop (lg+): a capped, scrollable box (nested scroll is fine with
//     a mouse, and a power user can flick through many quickly).
//   • Mobile (<lg): show 3, then an "Show all" button expands inline —
//     no nested scroll on touch, where it's fiddly.
// All rows are always in the DOM; rows past the 3rd are hidden on mobile
// via CSS until expanded, so the same markup serves both layouts.
function Section({ type, label, items }: { type: ListingType; label: string; items: Item[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const overflowing = items.length > 3;
  const hidden = items.length - 3;
  return (
    <section>
      <h2 className="text-[0.85rem] text-text-muted mb-3">
        {label} <span className="text-text-muted/70">— {items.length}</span>
      </h2>
      <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
        <div
          className={`divide-y divide-border-subtle ${
            overflowing
              ? "lg:max-h-[340px] lg:overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.25)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/30"
              : ""
          }`}
        >
          {items.map((it, idx) => (
            <div key={it.id} className={overflowing && idx >= 3 && !expanded ? "max-lg:hidden" : ""}>
              <Row type={type} item={it} />
            </div>
          ))}
        </div>
        {overflowing && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="lg:hidden w-full px-4 py-3 border-t border-border-subtle bg-transparent text-[0.8rem] text-text-secondary cursor-pointer transition-colors hover:text-accent-light"
          >
            {expanded ? "Show less" : `Show all ${items.length} (${hidden} more)`}
          </button>
        )}
      </div>
    </section>
  );
}

function Row({ type, item }: { type: ListingType; item: Item }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const submitted = formatDate(item.createdAt);

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

  return (
    // Test id so E2E can scope to one row. Filtering by "a div containing
    // this title" instead matches every ancestor too, which is how the
    // delete-flow locator used to pick up a *different* row's button.
    <div className="p-4" data-testid="submission-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[0.9rem] text-text-primary truncate">{item.title}</div>
            <span className={`px-2 py-0.5 rounded-lg text-[0.65rem] uppercase tracking-wider border ${STATUS_BADGE[item.status]}`}>
              {item.status}
            </span>
          </div>
          {item.subtitle && (
            <div className="text-[0.75rem] text-text-muted mt-0.5 truncate">{item.subtitle}</div>
          )}
          <div className="text-[0.7rem] text-text-muted mt-1 flex items-center gap-3 flex-wrap">
            <span>Submitted {submitted}</span>
            {(item.status === "approved" || item.status === "expired") && (
              <span className="flex items-center gap-2 text-text-secondary">
                <EyeIcon />
                {item.stats.views} view{item.stats.views === 1 ? "" : "s"}
                <span className="text-text-muted/50">·</span>
                <ClickIcon />
                {item.stats.clicks} click{item.stats.clicks === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {item.status === "rejected" && item.rejectedReason && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-[#ff4d4d]/8 border border-[#ff4d4d]/15 text-[0.75rem] text-[#ff8b8b] leading-relaxed">
              <span className="font-medium">Reviewer:</span> {item.rejectedReason}
            </div>
          )}
        </div>
        {!confirming ? (
          <div className="shrink-0 flex gap-1.5">
            {(item.status === "pending" || item.status === "approved") && (
              <Link
                href={EDIT_HREF[type](item.id)}
                className="inline-flex items-center px-3 py-1.5 rounded-lg bg-transparent border border-border text-text-secondary text-[0.75rem] no-underline transition-colors hover:border-accent hover:text-accent-light"
              >
                {item.status === "approved" ? "Propose a change" : "Edit"}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending}
              className="px-3 py-1.5 rounded-lg bg-transparent border border-[#ff4d4d]/25 text-[#ff6b6b] text-[0.75rem] cursor-pointer transition-colors hover:bg-[#ff4d4d]/10 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        ) : (
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            {item.status === "approved" && (
              <span className="text-[0.7rem] text-[#ff8b8b] text-right max-w-[200px] leading-snug">
                This is live in the community directory. Deleting it removes it for everyone, immediately, and is irreversible.
              </span>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="px-3 py-1.5 rounded-lg bg-[#ff4d4d]/15 border border-[#ff4d4d]/30 text-[#ff6b6b] text-[0.75rem] font-medium cursor-pointer transition-colors hover:bg-[#ff4d4d]/25 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="px-3 py-1.5 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary text-[0.75rem] cursor-pointer transition-colors hover:bg-white/[0.10] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ClickIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
