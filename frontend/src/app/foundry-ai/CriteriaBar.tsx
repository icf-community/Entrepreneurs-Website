"use client";

import { Field } from "@/components/forms/Field";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Panel } from "@/components/ui/Panel";
import { Icon } from "@/design-system/icons/Icon";
import type { AiMode, Spec, SpecAtom } from "@/lib/ai/types";
import type { SpecOp } from "./actions";

// ════════════════════════════════════════════════════════════════════
// The active criteria, above the results (AI-plan §5, §12). Every chip
// says what it is (must have / nice to have / not / either-or), can be
// flipped or removed, and is a real button with a visible border (F23).
// Editing costs nothing; running the edited search is a separate,
// counted action.
//
// A criterion is one pill: its words, what it is, and its two quiet actions
// inside the same outline (so there is one border, not a chip of buttons).
// Must-haves are lit, since they are what the search stands on; a "Not" is in
// the danger tone. Words always say it too: colour is never the only carrier.
// ════════════════════════════════════════════════════════════════════

function atomTone(atom: SpecAtom): string {
  if (atom.negated) return "border-danger-line bg-danger-muted";
  if (atom.required && !atom.group) return "border-lit-line bg-lit-muted";
  return "border-border-strong bg-tint-1";
}

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
    <Panel as="section" aria-label="Search criteria" className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-small font-medium text-text-secondary">Criteria</h2>
        {canUndo && (
          <Button
            variant="quiet"
            size="sm"
            type="button"
            disabled={busy}
            leading={<Icon name="undo" size={18} />}
            onClick={() => onEdit([{ op: "undo" }])}
          >
            Undo last change
          </Button>
        )}
      </div>

      {spec.atoms.length === 0 ? (
        <p className="mt-2 text-body text-text-muted">No criteria yet. Describe what you&apos;re looking for below.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {spec.atoms.map((atom) => (
            <li
              key={atom.id}
              // a pill on one line; when the buttons wrap under the words on a phone the corners stay round without becoming an oval
              className={`flex max-w-full flex-wrap items-center gap-x-2 rounded-[1.75rem] border py-0.5 pl-4 pr-1 ${atomTone(atom)}`}
            >
              <span className={`py-1.5 text-body ${atom.required && !atom.group && !atom.negated ? "text-accent-light" : "text-text-primary"}`}>
                {atom.negated ? "Not " : ""}{atom.label}
              </span>
              <span className="text-small text-text-secondary">
                {atom.negated ? "" : atom.group ? `· either of group ${atom.group.slice(1)}` : atom.required ? "· must have" : "· nice to have"}
                {atom.source === "job" ? " · from the job" : ""}
              </span>
              <span className="flex items-center">
                {!atom.negated && !atom.group && (
                  <Button
                    variant="quiet"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() => onEdit([{ op: "set_required", atom: atom.id, required: !atom.required }])}
                    // WCAG 2.5.3 (axe label-content-name-mismatch): the name must contain the words on the button. It used
                    // to read "Make <label> nice to have" / "Make <label> a must-have", which contains neither.
                    aria-label={`${atom.required ? "Make optional" : "Make required"}: ${atom.label}`}
                  >
                    {atom.required ? "Make optional" : "Make required"}
                  </Button>
                )}
                <Button
                  variant="quiet"
                  size="sm"
                  type="button"
                  disabled={busy}
                  leading={<Icon name="close" size={16} />}
                  onClick={() => onEdit([{ op: "remove", atom: atom.id }])}
                  aria-label={`Remove ${atom.label}`}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {mode === "recruiter" && jobAudience && (
        <AudiencePicker spec={spec} jobAudience={jobAudience} busy={busy} onEdit={onEdit} />
      )}
      {mode !== "network" && spec.atoms.some((a) => a.kind === "tool" || a.kind === "language") && (
        <Checkbox
          className="mt-4"
          label="Give part credit for closely related tools (for example TensorFlow for PyTorch)"
          checked={spec.transferable}
          disabled={busy}
          onChange={(e) => onEdit([{ op: "set_transferable", value: e.target.checked }])}
        />
      )}
    </Panel>
  );
}

function AudiencePicker({
  spec, jobAudience, busy, onEdit,
}: { spec: Spec; jobAudience: string; busy: boolean; onEdit: (ops: SpecOp[]) => void }) {
  const allowed: ("students" | "graduates")[] =
    jobAudience === "both" ? ["students", "graduates"] : [jobAudience as "students" | "graduates"];
  const current = spec.audience ?? allowed;
  if (allowed.length < 2) {
    return <p className="mt-4 text-body text-text-muted">Searching {allowed[0]}, as this job is for {allowed[0]} only.</p>;
  }
  const toggle = (value: "students" | "graduates") => {
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    if (next.length > 0) onEdit([{ op: "set_audience", audience: next }]);
  };
  return (
    <div className="mt-4">
      <Field group label="Search among">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {allowed.map((value) => (
            // react-doctor-disable-next-line js-set-map-lookups -- array is provably bounded to a tiny fixed size (not user/data-scaled); O(n²) concern doesn't apply
            <Checkbox key={value} label={value === "students" ? "Students" : "Graduates"} checked={current.includes(value)} disabled={busy} onChange={() => toggle(value)} />
          ))}
        </div>
      </Field>
    </div>
  );
}
