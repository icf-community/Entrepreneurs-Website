"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/design-system/icons/Icon";
import { Chip } from "./Chip";
import { SearchField } from "./SearchField";

// ════════════════════════════════════════════════════════════════════
// Foundry · ChipSet (Lumen)
//
// The wrap of chips both ChipGroups render, and the one place a long set is kept short. Up to
// `collapseAfter` chips (12) it is a plain wrap. Beyond that (the ~170 skills) it is a pick:
//
//   closed   only the chosen chips show, then a ring with a plus. Nothing chosen: just the ring.
//   open     a recessed panel: a search box and the ring (now a cross) on one line, the whole set
//            below in a scrolling wrap. Typing narrows it. Escape closes and returns to the ring.
//
// Every chip stays in the DOM in both states and is the same element throughout (the closed state
// only `hidden`s the unchosen ones), so a chosen chip is never re-parented, focus never drops, and the
// whole set is still there for assistive tech and for anything that reads the page. Chips keep their
// own semantics: each is a <button aria-pressed>, supplied by the caller's `onToggle`.
//
// The disclosure is a plain button-controlled region on purpose, so the popover primitive can replace
// the wrapper later without touching a caller. Nothing here holds the selection: callers own it.
// ════════════════════════════════════════════════════════════════════

export type ChipSetItem = {
  /** Unique within the set. */
  id: string;
  label: string;
  pressed: boolean;
  onToggle: () => void;
};

// A ref callback, not an effect: it moves focus into the search box the moment it mounts, with no state set.
const focusOnMount = (el: HTMLInputElement | null) => {
  el?.focus();
};

export function ChipSet({
  items,
  name,
  collapseAfter = 12,
}: {
  items: readonly ChipSetItem[];
  /** What the chips are, plural and lowercase ("skills"). It names the search box and the ring. */
  name: string;
  /** Sets larger than this are collapsed behind the ring. Pass Infinity to always show every chip. */
  collapseAfter?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  if (items.length <= collapseAfter) {
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <Chip key={it.id} pressed={it.pressed} onClick={it.onToggle}>
            {it.label}
          </Chip>
        ))}
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const nothingMatches = open && !items.some((it) => matches(it.label));
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div
      className="lm-pick"
      data-open={open || undefined}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          // closes the pick only: not a dialog or panel around it
          e.preventDefault();
          e.stopPropagation();
          close();
          toggleRef.current?.focus();
        }
      }}
    >
      <div className="lm-pick__head">
        {open ? (
          <SearchField
            label={`Search ${name}`}
            placeholder={`Search ${name}`}
            value={query}
            onChange={setQuery}
            inputRef={focusOnMount}
            // inside a form, Enter in this box would submit the form being filled in
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        ) : null}
        <button
          ref={toggleRef}
          type="button"
          className="lm-pick__toggle"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`All ${name}`}
          title={`All ${name}`}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>
      <div id={listId} className="lm-pick__list">
        {items.map((it, i) => (
          <Chip
            key={it.id}
            pressed={it.pressed}
            hidden={!(open ? matches(it.label) : it.pressed)}
            style={{ "--i": i } as CSSProperties}
            onClick={it.onToggle}
          >
            {it.label}
          </Chip>
        ))}
        {nothingMatches ? <p className="lm-pick__empty">No matches.</p> : null}
      </div>
    </div>
  );
}
