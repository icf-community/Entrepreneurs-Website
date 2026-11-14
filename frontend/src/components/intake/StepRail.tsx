"use client";

import { useId, useState } from "react";
import { GROUPS, ORDER, STEPS, TOTAL_SCREENS, indexOf, type StepId } from "@/lib/intake/steps";
import { Button } from "@/components/ui/Button";
import { Collapse } from "@/components/ui/Disclosure";
import { StepDots } from "@/components/ui/StepDots";
import { Icon } from "@/design-system/icons/Icon";

// ════════════════════════════════════════════════════════════════════
// Foundry · Intake step rail
//
// The rail's job is to show that the flow is finite and grouped, so the
// gate reads as short rather than as the first three of nine unknowns.
//
// It is the design system's StepDots, one per group under the group's own
// heading: what is behind you is lit, where you are is a lit ring, what
// is ahead is hollow, and a hairline lights as it is travelled.
//
// Every non-current step is pressable, whether already visited or not —
// almost everything past screen 01 is optional anyway (see IntakeFlow's
// validate()), and the server enforces the few compulsory fields at
// Finish/Skip regardless of which order the member clicked through.
// ════════════════════════════════════════════════════════════════════

type RailProps = {
  current: StepId;
  onJump: (id: StepId) => void;
};

export default function StepRail({ current, onJump }: RailProps) {
  // every screen before the current one, across all the groups: that is what has been travelled
  const done = ORDER.slice(0, indexOf(current));

  return (
    <nav aria-label="Intake progress" className="w-full">
      {GROUPS.map((group) => (
        <div key={group.label} className="mb-8 last:mb-0">
          <p className="font-display text-lead text-text-primary">{group.label}</p>
          <p className="mb-3 mt-1 text-small leading-[1.5] text-text-muted">{group.note}</p>

          <StepDots
            orientation="vertical"
            label={group.label}
            steps={group.steps.map((id) => ({ id, label: STEPS[id].label, num: STEPS[id].num ?? "—" }))}
            current={current}
            done={done}
            onSelect={(id) => onJump(id as StepId)}
          />
        </div>
      ))}
    </nav>
  );
}

/**
 * The same rail for a phone, where it has no column to sit in: closed to one line (the old
 * "{n} groups · {n} screens" caption is now the button's words), and it closes itself once you have jumped.
 * Everything in it stays in the DOM; closed, it is inert, so the keyboard skips it.
 */
export function StepRailDisclosure({ current, onJump, className = "" }: RailProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {GROUPS.length} groups · {TOTAL_SCREENS} screens
        <Icon name="chevron-down" size={16} className="lm-chev" />
      </Button>
      <Collapse id={panelId} open={open}>
        <div className="pt-6">
          <StepRail
            current={current}
            onJump={(id) => {
              setOpen(false);
              onJump(id);
            }}
          />
        </div>
      </Collapse>
    </div>
  );
}
