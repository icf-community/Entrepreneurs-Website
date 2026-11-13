import type { CSSProperties, ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Meter (Lumen)
//
// A value inside a known range, drawn as light: a ring that fills (a spend
// against its cap, a match out of ten) or a bar. The semantics are the
// platform's own <meter>, visually hidden and named, so the figure is
// announced as a meter with its value; the ring or bar is the picture of it.
// Put the figure in the children as well when it should be seen (a number
// inside the ring, text beside the bar). Not a ProgressBar: that is progress
// toward finishing something, this is where a quantity stands.
//
//   tone   lit (amber, the default) · success · danger · info. Tone is meaning:
//          use danger for a quantity that has crossed its limit.
//   size   sm 32 · md 48 · lg 72 (ring only)
//
// MeterGlyph is the drawing alone, for Stat to set beside a number that
// already says it in words.
// ════════════════════════════════════════════════════════════════════

export type MeterTone = "lit" | "success" | "danger" | "info";

/** 0..1, clamped; a broken value or an empty range reads as empty rather than as NaN. */
function ratioOf(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

const progress = (ratio: number) => ({ "--lm-p": ratio }) as CSSProperties;

function Drawing({ ratio, variant }: { ratio: number; variant: "ring" | "bar" }) {
  if (variant === "bar") {
    return (
      <span className="lm-meter__bar" style={progress(ratio)}>
        <span className="lm-meter__barfill" />
      </span>
    );
  }
  return (
    <svg className="lm-meter__svg" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <circle className="lm-meter__track" cx="18" cy="18" r="15.5" />
      <circle
        className="lm-meter__arc"
        cx="18"
        cy="18"
        r="15.5"
        pathLength={100}
        strokeDasharray={`${Math.round(ratio * 1000) / 10} 100`}
      />
    </svg>
  );
}

export function Meter({
  value,
  min = 0,
  max = 100,
  label,
  valueText,
  variant = "ring",
  tone = "lit",
  size = "md",
  className = "",
  children,
}: {
  value: number;
  min?: number;
  max?: number;
  /** The accessible name: what is being measured ("Matching spend today"). */
  label: string;
  /** The value in words when the bare number is not enough ("$0.12 of $5.00"). */
  valueText?: string;
  variant?: "ring" | "bar";
  tone?: MeterTone;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Visible text: the centre of the ring, or the figure beside the bar. */
  children?: ReactNode;
}) {
  return (
    <div
      className={`lm-meter ${className}`.trim()}
      data-variant={variant === "bar" ? "bar" : undefined}
      data-size={size === "md" ? undefined : size}
      data-tone={tone === "lit" ? undefined : tone}
    >
      <meter className="sr-only" min={min} max={max} value={value} aria-label={label} aria-valuetext={valueText}>
        {valueText ?? String(value)}
      </meter>
      <Drawing ratio={ratioOf(value, min, max)} variant={variant} />
      {children ? <span className="lm-meter__text">{children}</span> : null}
    </div>
  );
}

/** The drawing without the semantics: decorative, for a number that is already written out beside it. */
export function MeterGlyph({
  value,
  min = 0,
  max = 100,
  variant = "ring",
  tone = "lit",
  size = "md",
  className = "",
}: {
  value: number;
  min?: number;
  max?: number;
  variant?: "ring" | "bar";
  tone?: MeterTone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`lm-meter ${className}`.trim()}
      data-variant={variant === "bar" ? "bar" : undefined}
      data-size={size === "md" ? undefined : size}
      data-tone={tone === "lit" ? undefined : tone}
    >
      <Drawing ratio={ratioOf(value, min, max)} variant={variant} />
    </span>
  );
}
