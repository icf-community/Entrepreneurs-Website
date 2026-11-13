"use client";

import { GROUPS, STEPS, indexOf, type StepId } from "@/lib/intake/steps";
import { labelCls } from "@/components/forms/styles";

// ════════════════════════════════════════════════════════════════════
// Foundry · Intake step rail
//
// The rail's job is to show that the flow is finite and grouped, so the
// gate reads as short rather than as the first three of nine unknowns.
//
// Every non-current step is pressable, whether already visited or not —
// almost everything past screen 01 is optional anyway (see IntakeFlow's
// validate()), and the server enforces the few compulsory fields at
// Finish/Skip regardless of which order the member clicked through.
// ════════════════════════════════════════════════════════════════════

export default function StepRail({
  current,
  onJump,
}: {
  current: StepId;
  onJump: (id: StepId) => void;
}) {
  const currentIdx = indexOf(current);

  return (
    <nav aria-label="Intake progress" className="w-full">
      {GROUPS.map((group) => (
        <div key={group.label} className="mb-8 last:mb-0">
          <p className={`${labelCls} mb-1`}>{group.label}</p>
          <p className="mb-3 text-small leading-[1.5] text-text-muted">{group.note}</p>

          <ul className="space-y-1">
            {group.steps.map((id) => {
              const step = STEPS[id];
              const idx = indexOf(id);
              const isCurrent = idx === currentIdx;
              const isDone = idx < currentIdx;

              const numCls = isDone
                ? "text-signal"
                : isCurrent
                  ? "text-text-primary"
                  : "text-text-muted";

              const inner = (
                <span className="flex items-center gap-3">
                  <span className={`w-5 shrink-0 font-mono text-small ${numCls}`}>
                    {step.num ?? "—"}
                  </span>
                  <span className="truncate">{step.label}</span>
                </span>
              );

              if (isCurrent) {
                return (
                  <li key={id}>
                    <div
                      aria-current="step"
                      className="rounded-lg border border-border-strong bg-tint-3 px-3 py-2 text-body font-medium text-text-primary"
                    >
                      {inner}
                    </div>
                  </li>
                );
              }

              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onJump(id)}
                    className="w-full cursor-pointer rounded-lg border border-border bg-tint-1 px-3 py-2 text-left text-body text-text-secondary transition-colors duration-150 hover:border-border-strong hover:bg-tint-2 hover:text-text-primary"
                  >
                    {inner}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
