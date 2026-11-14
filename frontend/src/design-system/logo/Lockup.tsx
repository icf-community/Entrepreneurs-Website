import type { CSSProperties } from "react";
import { LOCKUP } from "./logo-data";

/**
 * The roundel with IMPERIAL / ENTREPRENEURS beside it. One flat colour (currentColor). `height` is the lockup's own height in px; the ring in it
 * is 0.9 of that, and the ring must stay 45 px or more, so the lockup is never shown under 51 px tall. Give it a label unless something beside
 * it already says the name.
 */
export function Lockup({
  height,
  label,
  className,
  style,
}: {
  height?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      data-logo="lockup"
      className={className}
      style={style}
      viewBox={`0 0 ${LOCKUP.w} ${LOCKUP.h}`}
      width={height ? Math.round((height * LOCKUP.w) / LOCKUP.h) : undefined}
      height={height}
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path fillRule={LOCKUP.rule} d={LOCKUP.d} />
    </svg>
  );
}
