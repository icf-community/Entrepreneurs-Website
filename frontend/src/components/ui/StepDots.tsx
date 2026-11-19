import type { ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · StepDots (Lumen)
//
// Where you are in a short flow. Done steps are lit, the current step is a lit
// ring, the rest are hollow, joined by a hairline that lights as it is
// travelled. It replaces the three step indicators the product grew (the
// onboarding "Step 1 of 2" bar, the intake's percentage line, the intake's
// grouped rail); a flow that reports a percentage uses ProgressBar beside it.
//
//   horizontal  a handful of steps; the labels are visually hidden (but read)
//               unless `showLabels`
//   vertical    a rail: every step is a labelled row, 44 px tall; give each
//               step a `num` to show its number ("01", or "—" for a screen
//               that is not a question). The number is part of the step's
//               name, as it always was ("01 Face & bio").
//
// The current step is never pressable and carries aria-current="step". With
// `onSelect` every other step is a button (a rail that lets you jump, as the
// intake's does); without it they are plain text. Done is whatever comes before
// the current step in this list. For a rail in groups (the intake has "Who you
// are" and "Unlock your matches") render one StepDots per group under its own
// heading and pass `done` explicitly, the ids already travelled across all of
// the groups.
// ════════════════════════════════════════════════════════════════════

export type StepItem = {
  id: string;
  label: string;
  /** A short number shown before the label, e.g. "01". */
  num?: string;
};

export function StepDots({
  steps,
  current,
  done,
  label,
  onSelect,
  orientation = "horizontal",
  showLabels,
  className = "",
}: {
  steps: readonly StepItem[];
  /** The id of the current step. An id that is not in this list means the current step is in another group. */
  current: string;
  /** The ids already travelled. Defaults to the steps before `current` in this list. */
  done?: readonly string[];
  /** Names the list ("Intake progress"). */
  label: string;
  /** Makes every step but the current one a button. */
  onSelect?: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  showLabels?: boolean;
  className?: string;
}) {
  const at = steps.findIndex((step) => step.id === current);
  const travelled = new Set(done ?? []);
  const labelled = showLabels ?? orientation === "vertical";

  return (
    <ol
      aria-label={label}
      className={`lm-steps ${className}`.trim()}
      data-orientation={orientation}
      data-labelled={labelled && orientation === "horizontal" ? "" : undefined}
    >
      {steps.map((step, index) => {
        const state =
          step.id === current
            ? "current"
            : (done === undefined ? at !== -1 && index < at : travelled.has(step.id))
              ? "done"
              : "todo";
        const body: ReactNode = (
          <>
            <span className="lm-step__dot" aria-hidden="true" />
            {step.num !== undefined ? <span className="lm-step__num">{step.num}</span> : null}
            <span className={labelled ? "lm-step__label" : "sr-only"}>{step.label}</span>
          </>
        );
        return (
          <li key={step.id} data-state={state}>
            {state === "current" ? (
              <span className="lm-step" aria-current="step">
                {body}
              </span>
            ) : onSelect ? (
              <button type="button" className="lm-step" onClick={() => onSelect(step.id)}>
                {body}
              </button>
            ) : (
              <span className="lm-step">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
