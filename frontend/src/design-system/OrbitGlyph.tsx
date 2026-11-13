/**
 * A ring with one body in orbit: the visitor's glyph. It leads a lit button (turning slowly, quicker when the button is pointed at, see
 * components.css) and, with `spin="fast"`, stands in for a spinner. A spinner keeps turning under prefers-reduced-motion (a frozen one
 * reads as a hung request); a decorative orbit stops.
 */
export function OrbitGlyph({ spin, className = "" }: { spin?: "fast"; className?: string }) {
  return (
    <svg className={`lm-orbit ${className}`} data-spin={spin} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.42" />
      <g className="o">
        <circle cx="12" cy="2.4" r="2" fill="currentColor" />
      </g>
    </svg>
  );
}
