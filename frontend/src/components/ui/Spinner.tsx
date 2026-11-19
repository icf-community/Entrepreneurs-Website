import { OrbitGlyph } from "@/design-system/OrbitGlyph";

// ════════════════════════════════════════════════════════════════════
// Foundry · Spinner (Lumen)
//
// The orbit glyph, turning: a ring with one body in orbit. It takes the colour
// of the text it sits in (currentColor), so it is cream on a cream button and
// ink in a toolbar.
//
// It keeps turning, slowly, under prefers-reduced-motion (motion.css): a frozen
// spinner reads as a hung request, and rotation in a box this small is not a
// vestibular trigger.
//
// Without a `label` it is decorative (aria-hidden): use that when the busy
// state is already announced, as a loading Button does with aria-busy. With a
// `label` it is a polite status with the label as its text. Use it for a wait
// of unknown length that has no shape to show; where the shape of the
// result is known, show a Skeleton instead.
// ════════════════════════════════════════════════════════════════════

export type SpinnerSize = "sm" | "md" | "lg";

export function Spinner({ size = "md", label, className = "" }: { size?: SpinnerSize; label?: string; className?: string }) {
  if (!label) {
    return (
      <span className={`lm-spinner ${className}`} data-size={size} aria-hidden="true">
        <OrbitGlyph spin="fast" />
      </span>
    );
  }
  return (
    <span role="status" className={`lm-spinner ${className}`} data-size={size}>
      <OrbitGlyph spin="fast" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
