import type { ReactNode } from "react";
import { MeterGlyph, type MeterTone } from "./Meter";

// ════════════════════════════════════════════════════════════════════
// Foundry · Stat and StatGrid (Lumen)
//
// A label and a measured value: the unit of every admin counter. Fifteen text
// tiles on the AI page and three counters on the reports page were each a
// hand-copied box. A StatGrid is one ruled sheet (a single surface with
// hairlines between its cells), not a wall of cards; it reflows to the room it
// has.
//
// The words are the content. `meter` adds a drawing of the value against its
// limit (a ring at the cell's edge, or a bar under the value) and the drawing
// is decorative: the figures stay in the text ("$0.12 of $5.00"), so nothing
// depends on seeing it. Use it only where there is a limit to be against.
//
// Markup is a description list (dt the label, dd the value), so a screen
// reader hears "Matching spend today: $0.12 of $5.00". Stat belongs inside a
// StatGrid (a <dl>) or a <dl> of your own.
//
//   tone   "danger" for a value that has crossed its limit, "lit" for the one
//          that matters; default otherwise
//   size   md (a counter) · sm (long values: "p50 12ms · p95 40ms")
// ════════════════════════════════════════════════════════════════════

export function StatGrid({
  min = "md",
  className = "",
  children,
}: {
  /** The narrowest a cell gets before the grid drops a column: sm 10.5rem, md 14rem, lg 19rem. */
  min?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl className={`lm-statgrid ${className}`.trim()} data-min={min === "md" ? undefined : min}>
      {children}
    </dl>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  size = "md",
  meter,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  /** A line under the value that says what it counts. */
  hint?: ReactNode;
  tone?: "default" | "lit" | "danger";
  size?: "sm" | "md";
  /** Draws `value` against `max` (default 100): a ring (default) or a bar. Decorative; the text carries the figures. */
  meter?: { value: number; min?: number; max?: number; kind?: "ring" | "bar"; tone?: MeterTone };
  className?: string;
}) {
  const kind = meter ? (meter.kind ?? "ring") : null;
  return (
    <div
      className={`lm-stat ${className}`.trim()}
      data-size={size === "md" ? undefined : size}
      data-tone={tone === "default" ? undefined : tone}
      data-meter={kind ?? undefined}
    >
      <dt className="lm-stat__label">{label}</dt>
      <dd className="lm-stat__value">
        {value}
        {meter && kind ? (
          <MeterGlyph
            value={meter.value}
            min={meter.min}
            max={meter.max}
            variant={kind}
            tone={meter.tone ?? (tone === "danger" ? "danger" : "lit")}
            size="md"
            className={kind === "ring" ? "lm-stat__ring" : "lm-stat__bar"}
          />
        ) : null}
      </dd>
      {hint ? <dd className="lm-stat__hint">{hint}</dd> : null}
    </div>
  );
}
