"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/design-system/icons/Icon";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ChipSet } from "@/components/ui/ChipSet";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { SearchField } from "@/components/ui/SearchField";

// ════════════════════════════════════════════════════════════════════
// The filter chrome shared by /community, /opportunities, /events,
// /vcs and /admin/members. It was pasted five times and had already
// drifted — one copy had lost its focus padding, another its
// aria-expanded — which is the usual argument for extracting it, plus a
// sharper one: these are the controls that write to the URL, and a
// filter that writes the wrong param name is a broken shareable link.
//
// Nothing here holds filter state. It renders values and reports
// changes; useUrlFilters owns the state, and the URL owns that.
//
// The look is the field family's (forms.css): the search box is a pill,
// the toggles are chips, the number and date boxes are fields. A long set
// of options (the ~170 skills) is kept short by ChipSet: only what is
// chosen shows, and a ring opens the rest under a search box.
// ════════════════════════════════════════════════════════════════════

// Field names above a control, matching the form kit.
const FILTER_LABEL = "lm-label mb-2.5";

export function SearchInput({
  label, placeholder, value, onChange, className = "mb-4",
}: {
  /** The accessible name. These boxes have no visible label. */
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <SearchField label={label} placeholder={placeholder} value={value} onChange={onChange} />
    </div>
  );
}

export function FilterPanel({
  activeCount, onClear, resultCount, children,
}: {
  activeCount: number;
  onClear: () => void;
  /** Rendered into a role="status" region — include an sr-only noun. */
  resultCount: ReactNode;
  children: ReactNode;
}) {
  // Open on arrival when filters are already applied. Someone opening a
  // shared link should see which filters produced the view, not an
  // unexplained subset behind a collapsed panel.
  const [open, setOpen] = useState(activeCount > 0);
  const panelId = useId();

  return (
    <div className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          leading={<Icon name="filter" size={18} />}
        >
          Filters
          {activeCount > 0 && <span className="lm-count data">{activeCount}</span>}
          <Icon name="chevron-down" size={16} className="lm-chev" />
        </Button>

        {activeCount > 0 && (
          <Button type="button" variant="quiet" size="sm" onClick={onClear}>
            Clear all
          </Button>
        )}

        {/* Announced as filters change, so a screen-reader user hears the
            result count without having to go hunting for it. A measured value,
            so .data: tabular figures stop the row shifting as the digits change
            width. The one role="status" in the bar (admin.spec reads the first). */}
        <span role="status" className="data ml-auto text-small text-text-secondary">
          {resultCount}
        </span>
      </div>

      <Panel
        id={panelId}
        hidden={!open}
        // The class is applied only while open, so React remounting the
        // attribute is what fires the animation. Left on permanently it
        // would run once, invisibly, behind `hidden`.
        className={`grid gap-6 p-5 sm:p-6 ${open ? "anim-panel" : ""}`}
      >
        {children}
      </Panel>
    </div>
  );
}

export function ChipGroup({
  label, options, selected, onToggle,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <div className={FILTER_LABEL}>{label}</div>
      <ChipSet
        name={label.toLowerCase()}
        items={options.map((o) => ({
          id: o.value,
          label: o.label,
          pressed: selected.has(o.value),
          onToggle: () => onToggle(o.value),
        }))}
      />
    </div>
  );
}

/**
 * The single-choice variant: exactly one option is always active, so it
 * reports the chosen value rather than a toggle.
 */
export function ChipChoice<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div>
      <div className={FILTER_LABEL}>{label}</div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((o) => (
          <FilterChip
            key={o.value}
            label={o.label}
            active={value === o.value}
            onClick={() => onChange(o.value)}
          />
        ))}
      </div>
    </div>
  );
}

export function FilterChip({
  label, active, onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Chip pressed={active} onClick={onClick}>
      {label}
    </Chip>
  );
}

export function RangeFilter({
  label, hint, type, from, to, fromLabel, toLabel,
  fromPlaceholder, toPlaceholder, bounds, commitOn = "change", onFromChange, onToChange,
}: {
  label: string;
  hint?: ReactNode;
  type: "date" | "number";
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  fromPlaceholder?: string;
  toPlaceholder?: string;
  /** Number ranges clamp to the data's real bounds; date ranges clamp to each other. */
  bounds?: { min: number; max: number };
  /**
   * "change" for client-side filtering, where a keystroke costs a rerender.
   * "blur" where it costs a database query.
   */
  commitOn?: "change" | "blur";
  onFromChange: (next: string) => void;
  onToChange: (next: string) => void;
}) {
  return (
    <div>
      <div className={FILTER_LABEL}>
        {label}
        {hint && <span className="lm-label__hint">{hint}</span>}
      </div>
      {/* a pair of years shrinks to stay on one line; a pair of dates needs the room, so on a phone they stack ("to" between them) rather than
          wrap and leave the "to" at the end of a line */}
      <div className={type === "date" ? "grid gap-2 sm:flex sm:items-center sm:gap-3" : "flex items-center gap-3"}>
        <RangeInput
          type={type}
          ariaLabel={fromLabel}
          placeholder={fromPlaceholder}
          value={from}
          commitOn={commitOn}
          min={bounds?.min}
          max={type === "date" ? (to || undefined) : bounds?.max}
          onCommit={onFromChange}
        />
        <span className="text-body text-text-muted">to</span>
        <RangeInput
          type={type}
          ariaLabel={toLabel}
          placeholder={toPlaceholder}
          value={to}
          commitOn={commitOn}
          min={type === "date" ? (from || undefined) : bounds?.min}
          max={bounds?.max}
          onCommit={onToChange}
        />
      </div>
    </div>
  );
}

function RangeInput({
  type, ariaLabel, placeholder, value, min, max, commitOn, onCommit,
}: {
  type: "date" | "number";
  ariaLabel: string;
  placeholder?: string;
  value: string;
  min?: number | string;
  max?: number | string;
  commitOn: "change" | "blur";
  onCommit: (next: string) => void;
}) {
  // Locally controlled so a blur-committed field still resets when the URL
  // value changes underneath it — which "Clear all" does, and which an
  // uncontrolled defaultValue would silently ignore.
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value);
  }

  return (
    <Input
      type={type}
      compact
      aria-label={ariaLabel}
      data-spin="off"
      placeholder={placeholder}
      value={draft}
      min={min}
      max={max}
      onChange={(e) => {
        setDraft(e.target.value);
        if (commitOn === "change") onCommit(e.target.value);
      }}
      onBlur={(e) => { if (commitOn === "blur") onCommit(e.target.value); }}
      className={type === "number" ? "min-w-0 max-w-40 flex-1" : "min-w-0 max-w-64 flex-1 basis-44 max-sm:max-w-none"}
    />
  );
}
