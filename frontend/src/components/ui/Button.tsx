import type { ButtonHTMLAttributes, ReactNode } from "react";
import { OrbitGlyph } from "@/design-system/OrbitGlyph";

// ════════════════════════════════════════════════════════════════════
// Foundry · Button (Lumen)
//
// One implementation of the button treatments the app uses; the look lives in
// src/design-system/components.css (.lm-btn), keyed by data attributes, so a
// variant is a selector there and never a class string in a page.
//
//   primary      cream (sun) with the night on it: the strongest control the
//                system makes. One per view, ideally.
//   ghost        the neutral control: a surface and a firm outline.
//   quiet        text with a surface only when pointed at (toolbars, "Cancel").
//   dangerGhost  neutral until you are about to press it (Reject, Remove).
//   danger       the destructive action, drawn in the danger light.
//
// `lit` is for the one action a page exists for: a hairline of warm light
// round it and a pool of it underneath. `leading` puts an icon before the label
// (the orbit glyph is the brand's own).
//
// Two things this fixes beyond deduplication (kept from the old component):
//   * the transition list is explicit, so `outline-color` is never animated and
//     the global focus ring appears rather than fading in;
//   * a loading button keeps its label in the DOM (visually hidden) beside
//     aria-busy, so it never has no accessible name while submitting.
// ════════════════════════════════════════════════════════════════════

export type ButtonVariant = "primary" | "ghost" | "quiet" | "dangerGhost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "lg",
  loading = false,
  lit = false,
  leading,
  disabled,
  className = "",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the label for a turning orbit, disables the button and sets aria-busy. */
  loading?: boolean;
  /** The page's one lit action: warm light round and under the button. */
  lit?: boolean;
  /** An icon before the label (decorative; give the icon aria-hidden). */
  leading?: ReactNode;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      data-lit={lit || undefined}
      className={`lm-btn ${className}`}
    >
      {loading ? (
        <>
          {/* The orbit keeps turning, slowly, under prefers-reduced-motion
              (motion.css): a frozen spinner reads as a hung request. */}
          <OrbitGlyph spin="fast" />
          <span className="sr-only">{children}</span>
        </>
      ) : (
        <>
          {leading}
          {children}
        </>
      )}
    </button>
  );
}
