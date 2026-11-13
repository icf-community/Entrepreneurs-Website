import type { CSSProperties } from "react";
import type { IconName } from "./names";

/**
 * Lumen's UI icons: functional drawings on a 24 grid, 1.75 stroke, round caps and joins, one flat colour (currentColor). Identity
 * drawings (audiences, listing types) are Glyphs, not Icons. PLACEHOLDER: every name draws a ring until the icon pass lands.
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
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}
