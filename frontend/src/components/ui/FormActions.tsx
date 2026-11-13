import type { ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · FormActions (Lumen)
//
// The footer row of a form: the primary action and whatever sits beside it (Cancel,
// a status line). One primary per form; make it a <Button type="submit"> and put the
// quiet alternative after it in the DOM, so the tab order reaches the main action first.
// On a phone the buttons take the full width, one under the other.
//
//   align="start"    (default) beside the last field, reading order
//   align="end"      pushed to the right, the usual place for Cancel + Save
//   align="between"  a status on the left, the buttons on the right
// ════════════════════════════════════════════════════════════════════

export function FormActions({
  align = "start",
  className = "",
  children,
}: {
  align?: "start" | "end" | "between";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`lm-actions ${className}`} data-align={align === "start" ? undefined : align}>
      {children}
    </div>
  );
}
