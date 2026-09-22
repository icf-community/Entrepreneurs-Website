"use client";

import { useState, type ReactNode } from "react";
import { Dialog, closeDialog, dialogCloser } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";

// ════════════════════════════════════════════════════════════════════
// Foundry · One confirmation dialog, four uses
//
// Decline, withdraw, remove and block are the same interaction with
// different words: an irreversible-for-three-weeks act, confirmed once,
// with an error that has to land somewhere the member can see it.
//
// The body is a node rather than a string because every one of these has
// something specific and non-obvious to say, and a confirmation that
// only says "Are you sure?" is the kind nobody reads. Removing a
// connection, in particular, has to be honest that it cannot un-send an
// address somebody already has.
// ════════════════════════════════════════════════════════════════════

// The exact sentences withdraw_connection_request and remove_connection
// raise (via describeSupabaseError's 22023 passthrough) when the row this
// dialog is acting on already moved under it — accepted, declined,
// withdrawn or removed from another tab, another device, or the other
// party, between the card rendering and the confirm click landing. That
// state is not a failure to retry: the row is already gone in the way the
// member wanted, and re-showing the same stale card after "Cancel" would
// just repeat the same error on the next click.
const STALE_CONNECTION_ERRORS = new Set([
  "That request is no longer pending.",
  "That connection no longer exists.",
]);

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  variant = "danger",
  onConfirm,
  onSuccess,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  variant?: "danger" | "primary";
  /** Resolves to the action's Result; a failure keeps the dialog open.
   *  Only the discriminant is read, so `Result<void>` and `Result<T>`
   *  both fit — `Result<unknown>` would not accept the void form. */
  onConfirm: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Runs only after onConfirm SUCCEEDS. The row is dropped from the
   *  caller's list here and not in onClose, which also fires on Cancel
   *  and on Escape — wiring the removal there makes cancelling look
   *  exactly like succeeding. */
  onSuccess?: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(e: { currentTarget: HTMLElement }) {
    // Resolved BEFORE the await — see dialogCloser. e.currentTarget is
    // null by the time the action resolves.
    const close = dialogCloser(e);
    setBusy(true);
    setError(null);
    const res = await onConfirm();
    setBusy(false);
    if (!res.ok) {
      // The row is already stale — dropping it (onSuccess, same as a real
      // success) is more honest than leaving a dead card on screen that
      // will just raise the same error on every future click, in this tab,
      // until a reload finally refetches the list.
      if (STALE_CONNECTION_ERRORS.has(res.error)) {
        onSuccess?.();
        close();
        return;
      }
      setError(res.error);
      return;
    }
    onSuccess?.();
    // Close through the element so the browser restores focus to whatever
    // opened the dialog, rather than dropping it on <body>.
    close();
  }

  return (
    <Dialog
      onClose={onClose}
      label={title}
      className="w-full max-w-[460px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto"
    >
      <div className="px-6 py-5">
        <h2 className="font-display text-[1.15rem] text-text-primary tracking-tight">{title}</h2>
        <div className="mt-3 space-y-2 text-[0.85rem] text-text-secondary leading-relaxed">
          {body}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-[0.8rem] text-[#ff8080]">{error}</p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            size="sm"
            loading={busy}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
