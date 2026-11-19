import type { CSSProperties, ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · ProgressBar (Lumen)
//
// Progress toward finishing something: a hairline track, a lit fill, and a
// point of light at its leading edge (the masthead rule's gesture). It is
// role="progressbar" with a name and a value, so the number is announced;
// with no `value` it is indeterminate and a short light travels along it.
// The intake's "profile completeness" and the onboarding's "Step 1 of 2" were
// two hand-built bars; both are this.
//
// `start` and `end` carry the words that make the figure visible ("1 / 2",
// "50%"). Stacked, they sit under the bar; inline, `start` leads the bar and
// `end` trails it, on one line. Where a quantity stands in a known range, and
// is not progress, use Meter.
// ════════════════════════════════════════════════════════════════════

export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  size = "sm",
  tone = "lit",
  start,
  end,
  layout = "stacked",
  className = "",
}: {
  /** Omit for an indeterminate bar. */
  value?: number;
  max?: number;
  /** The accessible name ("Profile completeness"). */
  label: string;
  /** The value in words when the bare number is not enough ("Step 1 of 2"). */
  valueText?: string;
  size?: "sm" | "md";
  tone?: "lit" | "success";
  start?: ReactNode;
  end?: ReactNode;
  layout?: "stacked" | "inline";
  className?: string;
}) {
  const indeterminate = value === undefined;
  const ratio = indeterminate || !(max > 0) ? 0 : Math.min(1, Math.max(0, value / max));
  const bar = (
    <div
      className="lm-progress__track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuetext={valueText}
      style={{ "--lm-p": ratio } as CSSProperties}
    >
      <span className="lm-progress__fill" />
      <span className="lm-progress__point" />
    </div>
  );
  const hasWords = start !== undefined || end !== undefined;
  return (
    <div
      className={`lm-progress ${className}`.trim()}
      data-size={size === "sm" ? undefined : size}
      data-tone={tone === "lit" ? undefined : tone}
      data-indeterminate={indeterminate || undefined}
    >
      {layout === "inline" ? (
        <div className="lm-progress__row">
          {start !== undefined ? <span className="lm-progress__text">{start}</span> : null}
          {bar}
          {end !== undefined ? <span className="lm-progress__text">{end}</span> : null}
        </div>
      ) : (
        <>
          {bar}
          {hasWords ? (
            <div className="lm-progress__foot">
              <span>{start}</span>
              <span>{end}</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
