import type { ComponentProps } from "react";
import { Icon } from "@/design-system/icons/Icon";

// ════════════════════════════════════════════════════════════════════
// Foundry · Chip (Lumen)
//
// A pill you can switch on: a sector, a skill, a role in a filter. The one toggle
// chip both ChipGroups render (forms/ChipGroup picks ids, filters/FilterBar
// picks strings), and the tag that removes a chosen value.
//
//   pressed      a toggle: sets aria-pressed and the lit look. Chosen is amber (a lit
//                wash, a lit edge, a cream word) with a drawn tick, so state never
//                rests on colour alone.
//   lit          the lit look without aria-pressed: a chosen value whose press removes it
//   removable    a drawn × at the end (decorative; the button's name stays its words)
//   size="sm"    36 px for a dense row of tags; the default is 40
//
// Always a <button type="button">, so it never submits the form it sits in. The look
// is in forms.css (.lm-chip); a long set of chips belongs in a <ChipSet>, which keeps it short.
// ════════════════════════════════════════════════════════════════════

export function Chip({
  pressed,
  lit = false,
  removable = false,
  size = "md",
  className = "",
  children,
  ...rest
}: {
  pressed?: boolean;
  lit?: boolean;
  removable?: boolean;
  size?: "sm" | "md";
} & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={pressed}
      data-lit={lit || undefined}
      data-size={size === "sm" ? "sm" : undefined}
      className={`lm-chip ${className}`}
    >
      <span className="lm-chip__label">{children}</span>
      {removable ? <Icon name="close" size={14} className="lm-chip__x" /> : null}
    </button>
  );
}
