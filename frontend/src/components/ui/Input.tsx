import type { ComponentProps } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Input (Lumen)
//
// A single-line field: text, email, url, number, date, time, password, file.
// It is a plain <input> wearing the family's class (.lm-field in forms.css), so
// every prop and the ref pass straight through. Put it inside a <Field> (or a
// <label>) so it has a name; the label above it is the name, a placeholder is not.
//
//   invalid   marks it wrong (aria-invalid); <Field error> does this for you
//   compact   44 px instead of 48, for dense rows such as a range in a filter
//
// States: hover warms the edge, focus lights it, [disabled] and [readonly] are
// quieter by structure, aria-busy="true" breathes. All of it is CSS.
// ════════════════════════════════════════════════════════════════════

export function Input({
  invalid,
  compact = false,
  className = "",
  ...rest
}: { invalid?: boolean; compact?: boolean } & ComponentProps<"input">) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || rest["aria-invalid"]}
      data-size={compact ? "sm" : undefined}
      className={`lm-field ${className}`}
    />
  );
}
