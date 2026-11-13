import type { ComponentProps } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Textarea (Lumen)
//
// The multi-line field. The same face as <Input> (.lm-field), taller, and it
// resizes vertically by default; pass `className="resize-none"` where the layout
// must not move. Every prop and the ref pass through. Put the character counter in
// the <Field hint>, where a screen reader hears it with the name.
// ════════════════════════════════════════════════════════════════════

export function Textarea({
  invalid,
  compact = false,
  className = "",
  ...rest
}: { invalid?: boolean; compact?: boolean } & ComponentProps<"textarea">) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || rest["aria-invalid"]}
      data-size={compact ? "sm" : undefined}
      className={`lm-field ${className}`}
    />
  );
}
