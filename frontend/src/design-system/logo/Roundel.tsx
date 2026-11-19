import type { CSSProperties } from "react";
import { ROUNDEL } from "./logo-data";

/**
 * The 2026 roundel: a ring with a gap at the top and the rocket breaking out through it. One flat colour (currentColor): white on the
 * night, black on a light plate, nothing else. Never rotate, crop, outline, stretch, put anything through it, or set a word beside it.
 *
 * `size` is the width of the RING in px (so the rendered mark is 1.12 times as tall, because the rocket rises above the ring). Keep the
 * ring at 45 px or more and leave a quarter of the mark's own height clear around it. Without `size`, size it with CSS (width: n; height: auto).
 * Without `label` the mark is decorative; give it a label when it is the only thing naming the link or button it sits in.
 */
export function Roundel({
  size,
  label,
  className,
  style,
}: {
  size?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      data-logo="roundel"
      className={className}
      style={style}
      viewBox={`0 0 ${ROUNDEL.w} ${ROUNDEL.h}`}
      width={size}
      height={size ? Math.round((size * ROUNDEL.h) / ROUNDEL.w) : undefined}
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path fillRule="evenodd" d={ROUNDEL.d} />
    </svg>
  );
}
