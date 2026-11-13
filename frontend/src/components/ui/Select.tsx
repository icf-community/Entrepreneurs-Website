import type { ComponentProps } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Select (Lumen)
//
// A native <select> in the family's face: appearance none, with the chevron drawn
// in its own background so no wrapper is added and the <label> that holds it
// still names it. It stays a real select (keyboard, mobile pickers, type-ahead);
// only its skin is ours. Every prop and the ref pass through.
//
// For a list long enough to need a search box use SearchableMultiSelect
// (components/forms), which is a popover, not a select.
// ════════════════════════════════════════════════════════════════════

export function Select({
  invalid,
  compact = false,
  className = "",
  ...rest
}: { invalid?: boolean; compact?: boolean } & ComponentProps<"select">) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || rest["aria-invalid"]}
      data-size={compact ? "sm" : undefined}
      className={`lm-field ${className}`}
    />
  );
}
