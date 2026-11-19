import type { CSSProperties } from "react";
import { DRAWINGS } from "./drawings";
import type { IconName } from "./names";

/**
 * Lumen's UI icons: functional drawings on a 24 grid, 1.75 stroke, round caps and joins, one flat colour (currentColor).
 * Identity drawings (audiences, listing types, sign-up steps, event types) are Glyphs, not Icons.
 *
 * The family has one idea, taken from the roundel: an outline is never quite closed. Every closed shape has exactly one opening
 * (a ring that does not meet, a page with a missing corner, a house whose door is the gap), and where a part leaves the figure
 * (a handle, an arrow, a key's shaft) the outline opens there and the part passes through, as the rocket does. Arrows, chevrons and
 * marks are plain: a chevron is a chevron. docs/design-system/icons.md has the rules and the table of what replaces what.
 *
 * Pure and server-safe (no hooks). Without `title` the icon is decorative (aria-hidden); with it, it is an image with that name.
 * Size it with `size` (16, 20 and 24 are the drawn sizes) and colour it with the text colour of whatever holds it.
 */
export function Icon({ name, size = 20, className, style, title }: { name: IconName; size?: number; className?: string; style?: CSSProperties; title?: string }) {
  return (
    <svg
      data-icon={name}
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {DRAWINGS[name]}
    </svg>
  );
}
