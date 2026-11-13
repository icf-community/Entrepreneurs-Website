"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { ErrorBanner } from "@/components/forms/Banners";
import { Icon } from "@/design-system/icons/Icon";
import { OrbitGlyph } from "@/design-system/OrbitGlyph";
import type { BulkResult } from "./bulkTypes";

// Generic bulk-review shell, reused by every admin queue (profiles,
// opportunities, events, VCs). Owns selection state, a sticky action bar,
// and the approve/reject transitions. Each queue supplies its own card
// renderer + bulk action functions.
//
// Anatomy, the same on every queue: a "select all" line, then one row per item
// (a tick box, then the queue's own card), and, once anything is ticked, a
// raised bar that floats at the foot of the viewport with the count and the
// three things you can do (approve, reject with a reason, clear). The bar is the
// only lit thing on the page while it is there.

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

type Note = { text: string; tone: "success" | "lit" };

export function BulkReview<T>({ items, getId, renderCard, bulkApprove, bulkReject, noun, emptyMessage }: Props<T>) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState<Note | null>(null);
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
    setNote(null);
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
          ? { text: `${res.succeeded} done, ${res.failed} failed${res.firstError ? ` — ${res.firstError}` : ""}.`, tone: "lit" }
          : { text: `${res.succeeded} ${noun}${res.succeeded === 1 ? "" : "s"} updated.`, tone: "success" },
      );
      router.refresh();
    });
  };

  const ids = () => Array.from(selected);

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <Checkbox
          label={`Select all (${items.length})`}
          checked={allSelected}
          indeterminate={selected.size > 0 && !allSelected}
          onChange={toggleAll}
          className="text-text-muted"
        />
      )}

      {note && (
        <Notice tone={note.tone} role="status">
          {note.text}
        </Notice>
      )}

      {items.length === 0 && <EmptyState icon="check">{emptyMessage}</EmptyState>}

      {items.map((item) => {
        const id = getId(item);
        return (
          <div key={id} className="flex items-start gap-3">
            <SelectBox noun={noun} checked={selected.has(id)} onToggle={() => toggle(id)} />
            <div className="min-w-0 flex-1">{renderCard(item)}</div>
          </div>
        );
      })}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          pending={pending}
          error={error}
          rejecting={rejecting}
          reason={reason}
          onReason={setReason}
          onApprove={() => run(() => bulkApprove(ids()))}
          onStartReject={() => setRejecting(true)}
          onCancelReject={() => setRejecting(false)}
          onConfirmReject={() => run(() => bulkReject(ids(), reason.trim()))}
          onClear={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}

/** One row's tick box. The box is 22 px; the label around it makes the target 44 px without moving anything. */
function SelectBox({ noun, checked, onToggle }: { noun: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="-m-2.5 mt-3.5 grid shrink-0 cursor-pointer place-items-center p-2.5">
      <Checkbox checked={checked} onChange={onToggle} aria-label={`Select ${noun}`} />
    </label>
  );
}

/**
 * The raised bar at the foot of the viewport while anything is ticked: how many, then approve / reject / clear. Rejecting swaps the three for
 * a reason field and its confirm and cancel, in the same place, so the bar never changes size under the pointer.
 */
function BulkBar({
  count, pending, error, rejecting, reason, onReason, onApprove, onStartReject, onCancelReject, onConfirmReject, onClear,
}: {
  count: number;
  pending: boolean;
  error: string;
  rejecting: boolean;
  reason: string;
  onReason: (next: string) => void;
  onApprove: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onConfirmReject: () => void;
  onClear: () => void;
}) {
  const busy = pending ? <OrbitGlyph spin="fast" /> : undefined;
  return (
    <div className="anim-panel sticky bottom-4 z-30 mx-auto grid max-w-[640px] gap-3 rounded-2xl border border-lit-line bg-bg-raised p-4 shadow-pop">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="flex flex-wrap items-center gap-3">
        <span className="data inline-flex items-center gap-2 text-body font-medium text-text-primary">
          <Icon name="check" size={18} className="text-accent-light" />
          {count} selected
        </span>
        {rejecting ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <Input
              type="text"
              compact
              autoFocus
              aria-label="Rejection reason"
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              placeholder={`Reason — sent to all ${count}`}
              className="min-w-[12.5rem] flex-1"
            />
            <Button type="button" size="sm" variant="danger" disabled={pending || !reason.trim()} onClick={onConfirmReject} leading={busy}>
              {pending ? "Working…" : `Reject ${count}`}
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={onCancelReject}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" disabled={pending} onClick={onApprove} leading={busy}>
              {pending ? "Working…" : `Approve ${count}`}
            </Button>
            <Button type="button" size="sm" variant="dangerGhost" disabled={pending} onClick={onStartReject}>
              Reject…
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={onClear}>
              Clear
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
