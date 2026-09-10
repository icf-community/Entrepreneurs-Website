"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { inputCls, labelCls } from "@/components/forms/styles";

// ════════════════════════════════════════════════════════════════════
// Foundry · Intake controls
//
// The shared inputs the nine screens are built from. The rule running
// through all of them: anything you can press is drawn as a control — a
// surface and a border-strong outline — never as tinted text. That
// includes chip removals, file pickers and rank badges, which are the
// three places this app has historically shipped bare glyphs.
// ════════════════════════════════════════════════════════════════════

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className={`${labelCls} mb-1.5`} htmlFor={htmlFor}>
        {label}
      </label>
      {hint && <p className="mb-2.5 text-[0.8rem] leading-[1.6] text-text-muted">{hint}</p>}
      {children}
    </div>
  );
}

/** A radio group drawn as cards. Used for affiliation and single-choice lists. */
export function ChoiceCards<T extends string>({
  name,
  options,
  value,
  onChange,
  columns = 2,
}: {
  name: string;
  options: { value: T; label: string; blurb?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3;
}) {
  const cols = columns === 1 ? "grid-cols-1" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div role="radiogroup" aria-label={name} className={`grid grid-cols-1 gap-2 ${cols}`}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`cursor-pointer rounded-lg border px-4 py-3 text-left transition-colors duration-150 ${
              on
                ? "border-accent bg-white/[0.10]"
                : "border-border-strong bg-white/[0.03] hover:border-accent hover:bg-white/[0.06]"
            }`}
          >
            <span
              className={`block text-[0.85rem] font-medium ${on ? "text-text-primary" : "text-text-secondary"}`}
            >
              {o.label}
            </span>
            {o.blurb && (
              <span className="mt-0.5 block text-[0.75rem] leading-[1.5] text-text-muted">{o.blurb}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Small pill row for single-choice short options (urgency, hours,
 *  recruiting). `value`/`onChange` deal in the coded string a CHECK
 *  constraint accepts; `label` is copy only. */
export function PillChoice({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`cursor-pointer rounded-lg border px-4 py-2 text-[0.8rem] transition-colors duration-150 ${
              on
                ? "border-accent bg-accent font-medium text-bg-primary"
                : "border-border-strong bg-white/[0.03] text-text-secondary hover:border-accent hover:text-text-primary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Open text input with suggestions, for interests and hobbies. Anything
 * typed is accepted — the suggestion list is a shortcut, not a whitelist.
 * These fields are never filtered on (only displayed), so a closed list
 * would cost accuracy for no benefit. Skills are the opposite case — see
 * SkillPicker below, which commits only from the closed taxonomy.
 */
export function TagInput({
  id,
  placeholder,
  suggestions,
  values,
  onAdd,
  onRemove,
  max,
}: {
  id?: string;
  placeholder: string;
  suggestions: string[];
  values: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const atMax = max !== undefined && values.length >= max;

  const lower = values.map((v) => v.toLowerCase());
  const matches = draft.trim()
    ? suggestions
        .filter(
          (s) =>
            s.toLowerCase().includes(draft.trim().toLowerCase()) && !lower.includes(s.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  const commit = (raw: string) => {
    const v = raw.trim().replace(/\s+/g, " ");
    if (!v || atMax) return;
    if (lower.includes(v.toLowerCase())) {
      setDraft("");
      return;
    }
    onAdd(v);
    setDraft("");
  };

  const trimmed = draft.trim();
  const canAddTyped = trimmed !== "" && !atMax && !lower.includes(trimmed.toLowerCase());

  return (
    <div>
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {values.map((v) => (
            <li key={v}>
              <span className="inline-flex items-center gap-1 rounded-lg border border-border-strong bg-white/[0.06] py-1 pl-3 pr-1 text-[0.775rem] text-text-primary">
                {v}
                <button
                  type="button"
                  onClick={() => onRemove(v)}
                  aria-label={`Remove ${v}`}
                  // The visible box stays chip-sized so the pill doesn't bulk up, but
                  // the actual tap target extends 4px past it on every side via the
                  // pseudo-element below — safe because chips sit in an 8px gap-2
                  // grid, so two adjacent extended targets meet without overlapping.
                  className="relative ml-0.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-border-strong bg-white/[0.04] text-text-secondary transition-colors duration-150 before:absolute before:-inset-1 before:content-[''] hover:border-accent hover:text-text-primary"
                >
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
                    <path
                      d="M1 1L8 8M8 1L1 8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <input
        id={id}
        type="text"
        aria-label={placeholder}
        value={draft}
        disabled={atMax}
        list={listId}
        placeholder={atMax ? `That's the maximum (${max})` : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          }
          if (e.key === "Backspace" && !draft && values.length) onRemove(values[values.length - 1]);
        }}
        onBlur={() => commit(draft)}
        className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-60`}
      />
      <datalist id={listId}>
        {matches.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {canAddTyped && (
        <button
          type="button"
          onClick={() => commit(draft)}
          className="mt-2 cursor-pointer rounded-lg border border-border-strong bg-white/[0.06] px-3 py-1.5 text-[0.775rem] font-medium text-text-primary transition-colors duration-150 hover:border-accent"
        >
          + Add &quot;{trimmed}&quot;
        </button>
      )}

      {matches.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {matches.map((m) => (
            <li key={m}>
              <button
                type="button"
                onClick={() => commit(m)}
                className="cursor-pointer rounded-lg border border-border bg-white/[0.02] px-3 py-1.5 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary"
              >
                + {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type SkillOption = { id: number; name: string; category: string | null };

/**
 * Search-and-pick over the CLOSED skills taxonomy. Unlike TagInput, nothing
 * typed here is ever committed directly — a skill is added only by
 * selecting one of the taxonomy matches, which is what makes the list
 * closed in practice and not just in the schema. On zero matches this
 * points at /contact rather than silently accepting the typed text, which
 * is the dead end a closed list would otherwise create.
 *
 * `suggested` renders as its own region, visually distinct from the
 * selected chips below (a dashed border and a "+" glyph rather than a
 * solid one) — see AvatarCropper's sibling comment in screens.tsx: a
 * suggestion is an offer, a chip is a claim, and conflating them would
 * make it look like the CV parse already changed the member's profile.
 */
export function SkillPicker({
  taxonomy,
  selectedIds,
  coreIds,
  suggested,
  onAdd,
  onAcceptSuggestion,
  onRemove,
  onToggleCore,
  maxCore,
}: {
  taxonomy: SkillOption[];
  selectedIds: number[];
  coreIds: number[];
  suggested: SkillOption[];
  onAdd: (id: number) => void;
  /** Same effect as onAdd, but tags the id as CV-sourced — see
   *  IntakeState.cvSkillIds — so a later CV swap knows this one came
   *  from the document rather than being typed in by hand. Only the
   *  intake flow's SkillsScreen tracks that; ProfileForm.tsx (no CV-swap
   *  concept of its own) falls back to plain onAdd. */
  onAcceptSuggestion?: (id: number) => void;
  onRemove: (id: number) => void;
  onToggleCore: (id: number) => void;
  maxCore: number;
}) {
  const acceptSuggestion = onAcceptSuggestion ?? onAdd;
  const [draft, setDraft] = useState("");
  const byId = new Map(taxonomy.map((t) => [t.id, t]));
  const selectedSet = new Set(selectedIds);

  const query = draft.trim().toLowerCase();
  const matches = query
    ? taxonomy.filter((t) => !selectedSet.has(t.id) && t.name.toLowerCase().includes(query)).slice(0, 8)
    : [];

  return (
    <div>
      {suggested.length > 0 && (
        <div className="mb-4 rounded-lg border border-dashed border-signal/50 bg-signal-muted/40 p-3">
          <p className="mb-2 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-signal">
            Found in your CV
          </p>
          <div className="flex flex-wrap gap-2">
            {suggested.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => acceptSuggestion(s.id)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-signal/40 bg-white/[0.03] px-3 py-1.5 text-[0.775rem] text-text-primary transition-colors duration-150 hover:border-signal hover:bg-signal-muted"
              >
                <span aria-hidden className="text-signal">+</span>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedIds.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {selectedIds.map((id) => {
            const skill = byId.get(id);
            if (!skill) return null;
            return (
              <li key={id}>
                <span className="inline-flex items-center gap-1 rounded-lg border border-border-strong bg-white/[0.06] py-1 pl-3 pr-1 text-[0.775rem] text-text-primary">
                  {skill.name}
                  <button
                    type="button"
                    onClick={() => onRemove(id)}
                    aria-label={`Remove ${skill.name}`}
                    // See TagInput's matching remove button above for why this
                    // extends its hit area via a pseudo-element instead of just
                    // growing the visible box.
                    className="relative ml-0.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-border-strong bg-white/[0.04] text-text-secondary transition-colors duration-150 before:absolute before:-inset-1 before:content-[''] hover:border-accent hover:text-text-primary"
                  >
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
                      <path d="M1 1L8 8M8 1L1 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <input
        type="text"
        aria-label="Search skills"
        value={draft}
        placeholder="Search ~180 skills…"
        onChange={(e) => setDraft(e.target.value)}
        className={inputCls}
      />

      {query && matches.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onAdd(m.id);
                  setDraft("");
                }}
                className="cursor-pointer rounded-lg border border-border bg-white/[0.02] px-3 py-1.5 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary"
              >
                + {m.name}
                {m.category && <span className="ml-1.5 text-text-muted">· {m.category}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {query && matches.length === 0 && (
        <p className="mt-2 text-[0.8rem] leading-[1.6] text-text-muted">
          Nothing matches that — the list is curated,{" "}
          <Link href="/contact" className="text-text-secondary underline underline-offset-2">
            tell us what&apos;s missing
          </Link>
          .
        </p>
      )}

      {selectedIds.length > 0 && (
        <div className="mt-4">
          <p className={`${labelCls} mb-2`}>
            Core skills — {coreIds.length} of {maxCore}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedIds.map((id) => {
              const skill = byId.get(id);
              if (!skill) return null;
              const isCore = coreIds.includes(id);
              const locked = !isCore && coreIds.length >= maxCore;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={locked}
                  aria-pressed={isCore}
                  onClick={() => onToggleCore(id)}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[0.775rem] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                    isCore
                      ? "border-signal/50 bg-signal-muted text-text-primary"
                      : "border-border-strong bg-white/[0.03] text-text-secondary hover:border-accent hover:text-text-primary"
                  }`}
                >
                  <span aria-hidden className={isCore ? "text-signal" : "text-text-muted"}>★</span>
                  {skill.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * File picker. Drag-and-drop is an accelerant, never the only route — the
 * dashed area is a real button, and there is a labelled control inside it,
 * because a drop zone that only responds to a drag is invisible to anyone
 * on a phone or a keyboard.
 */
export function FilePicker({
  accept,
  label,
  hint,
  file,
  onPick,
  onClear,
  preview,
}: {
  accept: string;
  label: string;
  hint: string;
  file: File | null;
  onPick: (f: File) => void;
  onClear: () => void;
  preview?: string | null;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  if (file) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-border-strong bg-white/[0.04] p-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- object URL, not a remote asset
          <img
            src={preview}
            alt=""
            className="h-16 w-16 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-white/[0.03] font-mono text-[0.65rem] text-text-secondary">
            {(file.name.split(".").pop() ?? "file").slice(0, 4).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.85rem] text-text-primary">{file.name}</span>
          <span className="block text-[0.75rem] text-text-muted">
            {(file.size / 1024).toFixed(0)} KB
          </span>
        </span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary"
        >
          Replace
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
        className={`w-full cursor-pointer rounded-lg border border-dashed px-6 py-8 text-center transition-colors duration-150 ${
          over ? "border-accent bg-white/[0.08]" : "border-border-strong bg-white/[0.03] hover:bg-white/[0.06]"
        }`}
      >
        <span className="block text-[0.9rem] font-medium text-text-primary">{label}</span>
        <span className="mt-1 block text-[0.775rem] text-text-muted">{hint}</span>
        <span className="mt-4 inline-block rounded-lg border border-border-strong bg-white/[0.06] px-4 py-2 text-[0.8rem] text-text-primary">
          Choose a file
        </span>
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        aria-label={label}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** Ordered multi-select. Rank is shown as a numbered badge, not by position
 *  alone. `values` holds coded `value`s in rank order — what actually gets
 *  written to profile_intents.rank via array position. */
export function RankPicker({
  options,
  values,
  onToggle,
  max,
}: {
  options: readonly { value: string; label: string }[];
  values: string[];
  onToggle: (v: string) => void;
  max: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const rank = values.indexOf(o.value);
        const on = rank >= 0;
        const full = !on && values.length >= max;
        return (
          <button
            key={o.value}
            type="button"
            disabled={full}
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-[0.8rem] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              on
                ? "border-accent bg-white/[0.10] text-text-primary"
                : "border-border-strong bg-white/[0.03] text-text-secondary hover:border-accent hover:text-text-primary"
            }`}
          >
            {on && (
              <span className="flex h-5 w-5 items-center justify-center rounded border border-signal/50 bg-signal-muted font-mono text-[0.65rem] text-signal">
                {rank + 1}
              </span>
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
