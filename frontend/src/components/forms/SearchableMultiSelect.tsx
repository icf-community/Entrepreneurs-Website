"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════════════
// Searchable multi-select dropdown.
//
// Used in filter panels where a list of values is long enough that the
// existing chip strip becomes unwieldy (e.g. Imperial has 200+ degree
// courses). The header button toggles the dropdown; selected items
// surface as removable chips below. The dropdown has an internal
// search input that filters the option list in-memory.
//
// Closes on Escape or click outside, matches Foundry's existing
// borderless `border-border` look.
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
    const onKey = (e: KeyboardEvent) => {
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

  return (
    <div>
      <div className="text-[0.75rem] text-text-muted mb-2">
        {label}
        {selected.size > 0 && (
          <span className="ml-2 text-text-muted">— {selected.size} selected</span>
        )}
      </div>

      <div ref={wrapRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full text-left px-3 py-2 bg-white/[0.03] border border-border rounded-lg text-[0.8rem] text-text-secondary transition-colors duration-150 hover:border-accent focus:border-accent/50 cursor-pointer flex items-center justify-between gap-2"
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span className="truncate">
            {selected.size === 0
              ? placeholder
              : `${selected.size} option${selected.size === 1 ? "" : "s"} selected`}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
            className={`shrink-0 text-text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div
            className="absolute left-0 right-0 top-full mt-1 z-30 overflow-hidden rounded-lg border border-border-strong bg-bg-card shadow-2xl"
            role="listbox"
          >
            <div className="p-2 border-b border-border-subtle">
              <input
                ref={inputRef}
                type="search"
                aria-label={placeholder}
                spellCheck={false}
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-2 bg-white/[0.03] border border-border rounded-md text-[0.8rem] text-text-primary placeholder:text-text-muted focus:border-accent/50"
              />
            </div>
            <div className="max-h-[260px] overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-[0.775rem] text-text-muted">{emptyText}</div>
              ) : (
                filtered.map((opt) => {
                  const on = selected.has(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggle(opt)}
                      className={`w-full text-left px-3 py-1.5 text-[0.8rem] cursor-pointer transition-colors flex items-center gap-2 border-0 bg-transparent ${
                        on
                          ? "text-accent-light bg-accent-muted/40"
                          : "text-text-secondary hover:bg-white/[0.03] hover:text-text-primary"
                      }`}
                      role="option"
                      aria-selected={on}
                    >
                      <span className={`inline-flex w-4 h-4 rounded border items-center justify-center shrink-0 ${
                        on ? "bg-accent border-accent text-bg-primary" : "border-border"
                      }`}>
                        {on && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{opt}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[...selected].sort((a, b) => a.localeCompare(b)).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => removeOne(v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.725rem] bg-accent-muted border border-accent/30 text-accent-light cursor-pointer transition-colors hover:bg-accent-muted/70"
            >
              <span className="truncate max-w-[200px]">{v}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
