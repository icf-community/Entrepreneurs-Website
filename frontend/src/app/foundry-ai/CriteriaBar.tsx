"use client";

import type { AiMode, Spec, SpecAtom } from "@/lib/ai/types";
import type { SpecOp } from "./actions";

// ════════════════════════════════════════════════════════════════════
// The active criteria, above the results (AI-plan §5, §12). Every chip
// says what it is (must have / nice to have / not / either-or), can be
// flipped or removed, and is a real button with a visible border (F23).
// Editing costs nothing; running the edited search is a separate,
// counted action.
// ════════════════════════════════════════════════════════════════════

const CHIP = "inline-flex items-center gap-1 rounded-lg border border-border-strong bg-white/[0.04] text-[0.8rem]";
const CHIP_BUTTON =
  "cursor-pointer rounded-md border border-border-strong bg-white/[0.05] px-2 py-1 text-[0.7rem] text-text-secondary " +
  "hover:border-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60";

export function CriteriaBar({
  mode, spec, canUndo, busy, jobAudience, onEdit,
}: {
  mode: AiMode;
  spec: Spec;
  canUndo: boolean;
  busy: boolean;
  jobAudience: string | null;
  onEdit: (ops: SpecOp[]) => void;
}) {
  const groups = new Map<string, SpecAtom[]>();
  for (const atom of spec.atoms) {
    if (atom.group) groups.set(atom.group, [...(groups.get(atom.group) ?? []), atom]);
  }

  return (
    <section aria-label="Search criteria" className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[0.7rem] uppercase tracking-wider text-text-muted">Criteria</h2>
        {canUndo && (
          <button type="button" className={CHIP_BUTTON} disabled={busy} onClick={() => onEdit([{ op: "undo" }])}>
            Undo last change
          </button>
        )}
      </div>

      {spec.atoms.length === 0 ? (
        <p className="mt-2 text-[0.8rem] text-text-muted">No criteria yet. Describe what you&apos;re looking for below.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {spec.atoms.map((atom) => (
            <li key={atom.id} className={`${CHIP} px-2.5 py-1.5`}>
              <span className="text-text-primary">
                {atom.negated ? "Not " : ""}{atom.label}
              </span>
              <span className="text-[0.7rem] text-text-muted">
                {atom.negated ? "" : atom.group ? `· either of group ${atom.group.slice(1)}` : atom.required ? "· must have" : "· nice to have"}
                {atom.source === "job" ? " · from the job" : ""}
              </span>
              {!atom.negated && !atom.group && (
                <button
                  type="button"
                  className={CHIP_BUTTON}
                  disabled={busy}
                  onClick={() => onEdit([{ op: "set_required", atom: atom.id, required: !atom.required }])}
                  aria-label={`Make ${atom.label} ${atom.required ? "nice to have" : "a must-have"}`}
                >
                  {atom.required ? "Make optional" : "Make required"}
                </button>
              )}
              <button
                type="button"
                className={CHIP_BUTTON}
                disabled={busy}
                onClick={() => onEdit([{ op: "remove", atom: atom.id }])}
                aria-label={`Remove ${atom.label}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {mode === "recruiter" && jobAudience && (
        <AudiencePicker spec={spec} jobAudience={jobAudience} busy={busy} onEdit={onEdit} />
      )}
      {mode !== "network" && spec.atoms.some((a) => a.kind === "tool" || a.kind === "language") && (
        <label className="mt-3 flex items-center gap-2 text-[0.8rem] text-text-secondary">
          <input
            type="checkbox"
            checked={spec.transferable}
            disabled={busy}
            onChange={(e) => onEdit([{ op: "set_transferable", value: e.target.checked }])}
          />
          Give part credit for closely related tools (for example TensorFlow for PyTorch)
        </label>
      )}
    </section>
  );
}

function AudiencePicker({
  spec, jobAudience, busy, onEdit,
}: { spec: Spec; jobAudience: string; busy: boolean; onEdit: (ops: SpecOp[]) => void }) {
  const allowed: ("students" | "graduates")[] =
    jobAudience === "both" ? ["students", "graduates"] : [jobAudience as "students" | "graduates"];
  const current = spec.audience ?? allowed;
  if (allowed.length < 2) {
    return <p className="mt-3 text-[0.8rem] text-text-muted">Searching {allowed[0]}, as this job is for {allowed[0]} only.</p>;
  }
  const toggle = (value: "students" | "graduates") => {
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    if (next.length > 0) onEdit([{ op: "set_audience", audience: next }]);
  };
  return (
    <fieldset className="mt-3">
      <legend className="text-[0.75rem] text-text-muted">Search among</legend>
      <div className="mt-1 flex flex-wrap gap-3 text-[0.8rem] text-text-secondary">
        {allowed.map((value) => (
          <label key={value} className="flex items-center gap-1.5">
            <input type="checkbox" checked={current.includes(value)} disabled={busy} onChange={() => toggle(value)} />
            {value === "students" ? "Students" : "Graduates"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
