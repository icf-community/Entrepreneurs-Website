"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { BulkResult } from "./bulkTypes";

// Generic bulk-review shell, reused by every admin queue (profiles,
// opportunities, events, VCs). Owns selection state, a sticky action bar,
// and the approve/reject transitions. Each queue supplies its own card
// renderer + bulk action functions.

type Props<T> = {
  items: T[];
  getId: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  bulkApprove: (ids: string[]) => Promise<BulkResult>;
  bulkReject: (ids: string[], reason: string) => Promise<BulkResult>;
  noun: string; // e.g. "profile", "opportunity"
  /**
   * Rendered in place of the list when `items` is empty. It lives HERE, and
   * not in the page that swaps this component out, because the confirmation
   * note is client state: a page that renders an empty state INSTEAD of this
   * component unmounts it, and the batch that clears the queue — the most
   * consequential one, and the only one that emails people — is the exact
   * batch whose "N updated." message gets destroyed on the way in.
   */
  emptyMessage: string;
};

export function BulkReview<T>({ items, getId, renderCard, bulkApprove, bulkReject, noun, emptyMessage }: Props<T>) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const allIds = items.map(getId);
  const allSelected = allIds.length > 0 && selected.size === allIds.length;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = () =>
    setSelected((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)));

  const run = (fn: () => Promise<BulkResult>) => {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSelected(new Set());
      setRejecting(false);
      setReason("");
      setNote(
        res.failed > 0
          ? `${res.succeeded} done, ${res.failed} failed${res.firstError ? ` — ${res.firstError}` : ""}.`
          : `${res.succeeded} ${noun}${res.succeeded === 1 ? "" : "s"} updated.`,
      );
      router.refresh();
    });
  };

  const ids = () => Array.from(selected);

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <label className="flex items-center gap-2 text-body text-text-muted cursor-pointer select-none">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Select all ({items.length})
        </label>
      )}

      {note && <div className="text-body text-accent-light">{note}</div>}

      {items.length === 0 && (
        <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-body text-text-muted">
          {emptyMessage}
        </div>
      )}

      {items.map((item) => {
        const id = getId(item);
        return (
          <div key={id} className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-5"
              checked={selected.has(id)}
              onChange={() => toggle(id)}
              aria-label={`Select ${noun}`}
            />
            <div className="flex-1 min-w-0">{renderCard(item)}</div>
          </div>
        );
      })}

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-30 mx-auto max-w-[640px] rounded-2xl bg-bg-card border border-accent/30 shadow-lg p-4">
          {error && <div role="alert" className="text-body text-danger mb-2">{error}</div>}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-body text-text-primary font-medium">{selected.size} selected</span>
            {!rejecting ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => bulkApprove(ids()))}
                  className="px-4 py-2 rounded-lg bg-accent text-bg-primary text-body font-medium border-0 cursor-pointer hover:bg-accent-light disabled:opacity-60"
                >
                  {pending ? "Working…" : `Approve ${selected.size}`}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setRejecting(true)}
                  className="px-4 py-2 rounded-lg bg-tint-2 border border-border-strong text-text-secondary text-body cursor-pointer transition-colors hover:bg-danger/10 hover:border-danger/50 hover:text-danger disabled:opacity-60"
                >
                  Reject…
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="px-3 py-2 text-body rounded-lg border border-border-strong bg-tint-2 text-text-secondary cursor-pointer transition-colors duration-150 hover:border-accent hover:text-text-primary"
                >
                  Clear
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 flex-wrap w-full">
                <input
                  type="text"
                  aria-label="Rejection reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={`Reason — sent to all ${selected.size}`}
                  className="flex-1 min-w-[200px] px-3 py-2 bg-tint-1 border border-border rounded-lg text-body text-text-primary focus:border-accent/50"
                />
                <button
                  type="button"
                  disabled={pending || !reason.trim()}
                  onClick={() => run(() => bulkReject(ids(), reason.trim()))}
                  className="px-4 py-2 rounded-lg bg-[#ff6b6b] text-bg-primary text-body font-medium border-0 cursor-pointer disabled:opacity-60"
                >
                  {pending ? "Working…" : `Reject ${selected.size}`}
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="px-3 py-2 text-body rounded-lg border border-border-strong bg-tint-2 text-text-secondary cursor-pointer transition-colors duration-150 hover:border-accent hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
