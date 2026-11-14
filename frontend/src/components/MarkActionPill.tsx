"use client";

import { useState } from "react";
import { FieldError } from "@/components/forms/Field";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/design-system/icons/Icon";
import { actionLabel, markAction, unmarkAction, type ListingKind } from "@/lib/listingActions";
import { settle } from "@/lib/settle";

// ════════════════════════════════════════════════════════════════════
// Foundry · Mark-as-applied / going pill
//
// Inline self-attestation control rendered next to the external apply
// or RSVP CTA on each listing card. Optimistic local toggle with
// rollback on RPC failure. Failure state is surfaced inline (a drawn
// mark and a sentence) rather than via a modal — the action is low-stakes.
//
// It is the system's toggle chip: chosen is lit and carries the drawn tick,
// not chosen carries the open ring (the icon set's "not yet"), so the state
// never rests on colour alone. While the write is in flight it is aria-busy
// and ignores a second press, but stays enabled, so a keyboard user's focus
// is not thrown to the top of the page.
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
    <div className="inline-flex flex-col items-start gap-2">
      <Chip
        pressed={marked}
        onClick={(e) => { e.stopPropagation(); void toggle(); }}
        aria-busy={pending || undefined}
        className="min-h-[var(--touch)] aria-busy:cursor-progress"
      >
        <span className="inline-flex items-center gap-2">
          {marked ? null : <Icon name="ring" size={16} />}
          {label}
        </span>
      </Chip>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
