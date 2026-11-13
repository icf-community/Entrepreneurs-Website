"use client";

import { useState } from "react";
import { actionLabel, markAction, unmarkAction, type ListingKind } from "@/lib/listingActions";
import { settle } from "@/lib/settle";

// ════════════════════════════════════════════════════════════════════
// Foundry · Mark-as-applied / going pill
//
// Inline self-attestation control rendered next to the external apply
// or RSVP CTA on each listing card. Optimistic local toggle with
// rollback on RPC failure. Failure state is surfaced inline (small
// red caption) rather than via a modal — the action is low-stakes.
// ════════════════════════════════════════════════════════════════════

type Props = {
  kind:     ListingKind;
  id:       string;
  initial:  boolean;
  /** Optional callback fired after a successful flip so the parent
   *  page can update derived state (e.g., /my-activity removes the row
   *  when the user unmarks). */
  onChange?: (nowMarked: boolean) => void;
};

export function MarkActionPill({ kind, id, initial, onChange }: Props) {
  const [marked,   setMarked]  = useState(initial);
  const [pending,  setPending] = useState(false);
  const [error,    setError]   = useState<string | null>(null);

  const toggle = async () => {
    if (pending) return;
    setError(null);
    const next = !marked;
    setMarked(next);   // optimistic
    setPending(true);
    const res = await settle(next ? markAction(kind, id) : unmarkAction(kind, id));
    setPending(false);
    if (!res.ok) {
      setMarked(!next);              // rollback
      setError("Couldn't save — try again.");
      return;
    }
    onChange?.(next);
  };

  const label = actionLabel(kind, marked);

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void toggle(); }}
        disabled={pending}
        aria-pressed={marked}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-body font-medium transition-colors cursor-pointer disabled:opacity-60 ${
          marked
            ? "bg-accent-muted text-accent-light border-accent/40 hover:border-accent"
            : "bg-transparent text-text-secondary border-border hover:border-accent hover:text-text-primary"
        }`}
      >
        <CheckIcon active={marked} />
        {label}
      </button>
      {error && (
        <span role="alert" className="text-small text-danger">{error}</span>
      )}
    </div>
  );
}

function CheckIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden
    >
      {active ? <polyline points="20 6 9 17 4 12" /> : <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}
