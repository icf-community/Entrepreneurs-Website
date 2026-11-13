"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { labelCls } from "@/components/forms/styles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Radio } from "@/components/ui/Radio";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";

// ════════════════════════════════════════════════════════════════════
// Foundry · Intake controls
//
// The shared inputs the intake screens are built from (the profile page
// uses them too, so every export and prop below is a contract). They are
// the design system's own pieces, composed: Chip for anything you pick or
// remove, Radio card for an exclusive choice, Input for a line of text,
// Notice for an offer (what the CV found), Button for an action. Nothing
// here names a colour or draws its own pill.
//
// The rule that ran through the old file still holds: anything you can
// press is drawn as a control, never as tinted text. That includes chip
// removals, file pickers and rank badges.
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
      <label className={`${labelCls} mb-2`} htmlFor={htmlFor}>
        {label}
      </label>
      {hint && <p className="-mt-1 mb-3 text-small leading-[1.55] text-text-muted">{hint}</p>}
      {children}
    </div>
  );
}

/** A radio group drawn as cards. Used for affiliation and single-choice lists. Native radios underneath, so the arrow keys move
 *  between the cards and the group is one stop in the tab order. */
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
    <div role="radiogroup" aria-label={name} className={`grid grid-cols-1 gap-2.5 ${cols}`}>
      {options.map((o) => (
        <Radio
          key={o.value}
          card
          name={name}
          value={o.value}
          checked={value === o.value}
          onChange={() => onChange(o.value)}
          label={o.label}
          hint={o.blurb}
        />
      ))}
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
          <Chip key={o.value} role="radio" aria-checked={on} lit={on} onClick={() => onChange(o.value)}>
            <span className="inline-flex items-center gap-2">
              {on ? <Icon name="check" size={14} /> : null}
              {o.label}
            </span>
          </Chip>
        );
      })}
    </div>
  );
}

/** The chosen values of an open list: each one a chip whose press removes it (named "Remove …"; the words on it are the value). */
function RemovableChips({
  items,
  onRemove,
}: {
  items: { key: string; label: string }[];
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-2">
      {items.map((it) => (
        <li key={it.key} className="max-w-full">
          <Chip lit removable aria-label={`Remove ${it.label}`} onClick={() => onRemove(it.key)}>
            {it.label}
          </Chip>
        </li>
      ))}
    </ul>
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
  const lowerSet = new Set(lower);
  const matches = draft.trim()
    ? suggestions
        .filter(
          (s) =>
            s.toLowerCase().includes(draft.trim().toLowerCase()) && !lowerSet.has(s.toLowerCase()),
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
      <RemovableChips items={values.map((v) => ({ key: v, label: v }))} onRemove={onRemove} />

      <Input
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
      />
      <datalist id={listId}>
        {matches.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {canAddTyped && (
        <div className="mt-3">
          <Chip className="py-2" onClick={() => commit(draft)}>
            <span className="inline-flex items-center gap-2 whitespace-normal text-left">
              <Icon name="plus" size={14} />
              <span className="sr-only">+ </span>
              Add &quot;{trimmed}&quot;
            </span>
          </Chip>
        </div>
      )}

      {matches.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {matches.map((m) => (
            <li key={m} className="max-w-full">
              <Chip onClick={() => commit(m)}>
                <span className="inline-flex items-center gap-2">
                  <Icon name="plus" size={14} />
                  <span className="sr-only">+ </span>
                  {m}
                </span>
              </Chip>
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
 * selected chips below (a lit notice with a spark, its chips plain "add"
 * chips rather than chosen ones) — see AvatarCropper's sibling comment in
 * screens.tsx: a suggestion is an offer, a chip is a claim, and conflating
 * them would make it look like the CV parse already changed the member's
 * profile.
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
  const coreSet = new Set(coreIds);

  const query = draft.trim().toLowerCase();
  const matches = query
    ? taxonomy.filter((t) => !selectedSet.has(t.id) && t.name.toLowerCase().includes(query)).slice(0, 8)
    : [];

  const chosen = selectedIds.flatMap((id) => {
    const skill = byId.get(id);
    return skill ? [{ key: String(id), label: skill.name }] : [];
  });

  return (
    <div>
      {suggested.length > 0 && (
        <div className="mb-4">
          <Notice tone="lit" icon="spark" title="Found in your CV">
            <div className="mt-3 flex flex-wrap gap-2">
              {suggested.map((s) => (
                <Chip key={s.id} onClick={() => acceptSuggestion(s.id)}>
                  <span className="inline-flex items-center gap-2">
                    <Icon name="plus" size={14} />
                    <span className="sr-only">+ </span>
                    {s.name}
                  </span>
                </Chip>
              ))}
            </div>
          </Notice>
        </div>
      )}

      <RemovableChips items={chosen} onRemove={(key) => onRemove(Number(key))} />

      <Input
        type="text"
        aria-label="Search skills"
        value={draft}
        placeholder="Search ~180 skills…"
        onChange={(e) => setDraft(e.target.value)}
      />

      {query && matches.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {matches.map((m) => (
            <li key={m.id} className="max-w-full">
              <Chip
                className="py-2"
                onClick={() => {
                  onAdd(m.id);
                  setDraft("");
                }}
              >
                <span className="inline-flex items-center gap-2 whitespace-normal text-left">
                  <Icon name="plus" size={14} />
                  <span className="sr-only">+ </span>
                  <span>
                    {m.name}
                    {m.category && <span className="ml-1.5 text-text-muted">· {m.category}</span>}
                  </span>
                </span>
              </Chip>
            </li>
          ))}
        </ul>
      )}

      {query && matches.length === 0 && (
        <p className="mt-3 text-small leading-[1.6] text-text-muted">
          Nothing matches that — the list is curated,{" "}
          <Link href="/contact" className="text-accent-light underline underline-offset-4">
            tell us what&apos;s missing
          </Link>
          .
        </p>
      )}

      {selectedIds.length > 0 && (
        <div className="mt-6 border-t border-border-subtle pt-5">
          <p className={`${labelCls} mb-3`}>
            Core skills — <span className="data">{coreIds.length}</span> of <span className="data">{maxCore}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedIds.map((id) => {
              const skill = byId.get(id);
              if (!skill) return null;
              const isCore = coreSet.has(id);
              const locked = !isCore && coreIds.length >= maxCore;
              return (
                <Chip key={id} disabled={locked} pressed={isCore} onClick={() => onToggleCore(id)}>
                  <span className="inline-flex items-center gap-2">
                    {isCore ? null : <Icon name="star" size={14} />}
                    {skill.name}
                  </span>
                </Chip>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** What a file is, in a few letters on a quiet tile (PDF, DOCX): the extension of the name, as the intake always showed it. */
export function FileTile({ filename }: { filename: string }) {
  return (
    <span
      aria-hidden
      className="data grid size-14 shrink-0 place-items-center rounded-lg bg-tint-3 text-caption font-medium text-text-secondary"
    >
      {(filename.split(".").pop() ?? "file").slice(0, 4).toUpperCase()}
    </span>
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
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-tint-2 p-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- object URL, not a remote asset
          <img src={preview} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <FileTile filename={file.name} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-text-primary">{file.name}</span>
          <span className="data block text-small text-text-muted">{(file.size / 1024).toFixed(0)} KB</span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Replace
        </Button>
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
        className={`grid w-full cursor-pointer justify-items-center gap-1 rounded-xl border border-dashed px-6 py-9 text-center transition-colors duration-150 ${
          over
            ? "border-lit-line bg-lit-muted"
            : "border-border-strong bg-tint-1 hover:border-lit-line hover:bg-tint-2"
        }`}
      >
        <Disc>
          <Icon name="upload" size={20} />
        </Disc>
        <span className="mt-2 block font-display text-lead text-text-primary">{label}</span>
        <span className="block text-small text-text-muted">{hint}</span>
        <span className="mt-3 block text-small font-semibold text-accent-light">Choose a file</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        aria-label={label}
        // the dropzone button above is the keyboard's way in; this input is only what the button opens, so it is not a tab stop of its own
        tabIndex={-1}
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
          // the rank is the chosen mark here, so the chip's own tick steps aside
          <Chip key={o.value} disabled={full} pressed={on} className="before:hidden" onClick={() => onToggle(o.value)}>
            <span className="inline-flex items-center gap-2">
              {on && <span className="lm-count">{rank + 1}</span>}
              {o.label}
            </span>
          </Chip>
        );
      })}
    </div>
  );
}
