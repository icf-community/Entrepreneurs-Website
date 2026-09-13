"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";
import { formatDate } from "@/lib/dates";
import { approveEdit, declineEdit } from "./actions";
import type { ListingEdit } from "@/lib/listings/edits";

// ════════════════════════════════════════════════════════════════════
// Foundry · Reviewing a change to something already published
//
// Different from the other admin queues in one way that matters: the
// listing is already live, so the reviewer is not deciding whether to
// publish it — they are deciding whether a *change* is safe. What they
// need is therefore a diff, not a card. Only changed fields are shown,
// old value beside new, because a full re-read of an unchanged
// description is exactly how a moved start time gets skimmed past.
//
// Time and location changes carry a flag. On a physical event with
// student attendees those are the safeguarding-relevant edits — a venue
// moved off campus, or a start pushed to 11pm — even when not one word
// of the description changed.
// ════════════════════════════════════════════════════════════════════

const KIND_LABEL: Record<ListingEdit["listingKind"], string> = {
  event: "Event",
  opportunity: "Opportunity",
  vc_grant: "VC / grant",
};

const PUBLIC_PATH: Record<ListingEdit["listingKind"], string> = {
  event: "/events",
  opportunity: "/opportunities",
  vc_grant: "/vcs",
};

const SAFETY_FIELDS = new Set(["event_at", "location"]);

type Props = {
  items: ListingEdit[];
  labels: Record<string, string>;
  /** Precomputed server-side so the diff and the emails agree. */
  changed: Record<string, string[]>;
};

export default function EditsReview({ items, labels, changed }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-[0.85rem] text-text-muted">
        No proposed changes. Published listings are all as their organisers left them.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {items.map((e) => (
        <EditCard key={e.id} edit={e} labels={labels} changed={changed[e.id] ?? []} />
      ))}
    </div>
  );
}

function EditCard({
  edit,
  labels,
  changed,
}: {
  edit: ListingEdit;
  labels: Record<string, string>;
  changed: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const safety = changed.filter((f) => SAFETY_FIELDS.has(f));

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-lg border border-border-strong text-[0.65rem] uppercase tracking-wider text-text-secondary">
              {KIND_LABEL[edit.listingKind]}
            </span>
            {safety.length > 0 && (
              <span className="px-2 py-0.5 rounded-lg border border-[#ff4d4d]/30 bg-[#ff4d4d]/10 text-[0.65rem] uppercase tracking-wider text-[#ff8b8b]">
                Time / place changed
              </span>
            )}
          </div>
          <h2 className="text-[1.05rem] text-text-primary mt-2">{edit.listingTitle}</h2>
          <p className="text-[0.75rem] text-text-muted mt-1">
            Proposed by {edit.proposedByName ?? "a member"} on {formatDate(edit.createdAt)}
          </p>
        </div>
        <Link
          href={`${PUBLIC_PATH[edit.listingKind]}/${edit.listingId}`}
          className="shrink-0 inline-flex items-center rounded-lg border border-border-strong bg-white/[0.05] px-3 py-1.5 text-[0.75rem] text-text-primary no-underline transition-colors hover:bg-white/[0.10] hover:border-accent"
        >
          View live listing
        </Link>
      </div>

      {changed.length === 0 ? (
        <p className="text-[0.8rem] text-text-muted">
          Nothing differs from the published version. Approving is harmless; declining is tidier.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8rem] border-collapse">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="py-2 pr-4 font-normal w-[22%]">Field</th>
                <th className="py-2 pr-4 font-normal">Published now</th>
                <th className="py-2 font-normal">Proposed</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {changed.map((f) => (
                <tr key={f} className="border-t border-border-subtle">
                  <td className="py-2 pr-4 text-text-secondary">
                    {labels[f] ?? f}
                    {SAFETY_FIELDS.has(f) && <span className="text-[#ff8b8b]"> •</span>}
                  </td>
                  <td className="py-2 pr-4 text-text-muted whitespace-pre-wrap break-words">
                    {render(edit.current[f])}
                  </td>
                  <td className="py-2 text-text-primary whitespace-pre-wrap break-words">
                    {render(edit.proposed[f])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      {!declining ? (
        <div className="flex flex-wrap gap-2 mt-5">
          <Button
            type="button"
            variant="primary"
            loading={pending}
            onClick={() => run(() => approveEdit(edit.id))}
          >
            Approve changes
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setDeclining(true)}>
            Decline
          </Button>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <label className="block text-[0.8rem] text-text-secondary" htmlFor={`reason-${edit.id}`}>
            Why? The organiser gets this, so it has to tell them what to change.
          </label>
          <textarea
            id={`reason-${edit.id}`}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-white/[0.02] border border-border-strong text-text-primary text-[0.85rem] resize-none"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              loading={pending}
              onClick={() => run(() => declineEdit(edit.id, reason))}
            >
              Decline changes
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function render(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}
