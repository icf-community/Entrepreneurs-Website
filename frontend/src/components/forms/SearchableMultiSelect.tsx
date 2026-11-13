"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/design-system/icons/Icon";
import { Chip } from "@/components/ui/Chip";
import { SearchField } from "@/components/ui/SearchField";

// ════════════════════════════════════════════════════════════════════
// Searchable multi-select dropdown.
//
// Used in filter panels where a list of values is long enough that the
// existing chip strip becomes unwieldy (e.g. Imperial has 200+ degree
// courses). The header button toggles the dropdown; selected items
// surface as removable chips below. The dropdown has an internal
// search input that filters the option list in-memory.
//
// Closes on Escape or click outside. The look is the field family's:
// the trigger wears a field's face and chevron, the list is a raised
// panel, the chosen values are lit chips (forms.css: .lm-field, .lm-ms,
// .lm-chip).
//
// Keyboard: Arrow Down from the search box enters the list, Up and Down
// move between options, Home and End jump to the ends, Up from the first
// option returns to the search box. Options are also still reachable with
// Tab, and Enter or Space toggles the focused one.
// ════════════════════════════════════════════════════════════════════

type Props = {
  label:        string;
  options:      string[];
  selected:     Set<string>;
  onChange:     (next: Set<string>) => void;
  placeholder?: string;
  emptyText?:   string;
};

export default function SearchableMultiSelect({
  label, options, selected, onChange,
  placeholder = "Search…",
  emptyText   = "No matches.",
}: Props) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const wrapRef             = useRef<HTMLDivElement | null>(null);
  const inputRef            = useRef<HTMLInputElement | null>(null);
  const listRef             = useRef<HTMLDivElement | null>(null);
  const triggerRef          = useRef<HTMLButtonElement | null>(null);

  // Click outside / Escape close.
  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Escape hands focus back to the button: the search box it was in is
    // unmounted by closing, which would otherwise drop focus to <body>.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown",  onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown",  onKey);
    };
  }, [open]);

  // Focus search input when dropdown opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value); else next.add(value);
    onChange(next);
  };

  const removeOne = (value: string) => {
    const next = new Set(selected);
    next.delete(value);
    onChange(next);
  };

  // Arrow keys move between the options. Home and End only act on an option, so they keep
  // their usual job (moving the caret) inside the search box.
  const onPopKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (opts.length === 0) return;
    const at = opts.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 && (e.key === "Home" || e.key === "End")) return;
    if (at < 0 && e.key === "ArrowUp") return;
    e.preventDefault();
    if (e.key === "Home") opts[0].focus();
    else if (e.key === "End") opts[opts.length - 1].focus();
    else if (e.key === "ArrowDown") opts[Math.min(at + 1, opts.length - 1)].focus();
    else if (at === 0) inputRef.current?.focus();
    else opts[at - 1].focus();
  };

  return (
    <div>
      <div className="lm-label mb-2">
        {label}
        {selected.size > 0 && (
          <span className="lm-label__hint">— {selected.size} selected</span>
        )}
      </div>

      <div ref={wrapRef} className="lm-ms">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="lm-field"
          data-trigger=""
          data-empty={selected.size === 0 || undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span className="truncate">
            {selected.size === 0
              ? placeholder
              : `${selected.size} option${selected.size === 1 ? "" : "s"} selected`}
          </span>
          <Icon name="chevron-down" size={18} className="lm-chev" />
        </button>

        {open && (
          <div className="lm-ms__pop anim-panel" onKeyDown={onPopKeyDown}>
            <div className="lm-ms__head">
              <SearchField
                label={placeholder}
                placeholder={placeholder}
                value={query}
                onChange={setQuery}
                inputRef={inputRef}
                // inside a form, Enter in this box would submit the form being filled in
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
              />
            </div>
            {filtered.length === 0 ? (
              <div className="lm-ms__empty">{emptyText}</div>
            ) : (
              <div ref={listRef} className="lm-ms__list" role="listbox" aria-multiselectable="true" aria-label={label}>
                {filtered.map((opt) => {
                  const on = selected.has(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggle(opt)}
                      className="lm-ms__opt"
                      role="option"
                      aria-selected={on}
                    >
                      <span className="lm-ms__box" aria-hidden="true" />
                      <span className="truncate">{opt}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {[...selected].sort((a, b) => a.localeCompare(b)).map((v) => (
            <Chip key={v} lit removable size="sm" title={`Remove ${v}`} onClick={() => removeOne(v)} className="max-w-full">
              {v}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
