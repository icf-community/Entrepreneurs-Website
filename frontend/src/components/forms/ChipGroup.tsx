import type { ReactNode } from "react";
import { ChipSet } from "@/components/ui/ChipSet";
import { labelCls } from "./styles";

export type ChipItem = { id: number; name: string };

// A captioned set of chips for picking ids (skills, sectors) inside a form. Each chip is a toggle
// button (aria-pressed) that reports its id; the set is held by the caller. Rendered through the
// shared ChipSet, so a long set (the ~170 skills on the opportunity form) shows only what is chosen
// and opens the rest behind a ring with a search box, while a short one (the sectors) is a plain wrap.
// The filters have their own ChipGroup, keyed by string (components/filters/FilterBar), and the same ChipSet.
export function ChipGroup({
  label, items, selected, onToggle, hint = "optional, pick any that fit",
}: {
  label: ReactNode;
  items: ChipItem[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  hint?: ReactNode;
}) {
  return (
    <div>
      <div className={`${labelCls} mb-2.5`}>
        {label}{hint && <span className="lm-label__hint">— {hint}</span>}
      </div>
      <ChipSet
        name={typeof label === "string" ? label.toLowerCase() : "options"}
        items={items.map((it) => ({
          id: String(it.id),
          label: it.name,
          pressed: selected.has(it.id),
          onToggle: () => onToggle(it.id),
        }))}
      />
    </div>
  );
}
