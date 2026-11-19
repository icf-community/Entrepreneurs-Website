import { Spinner } from "./Spinner";

// C2: shown over a list that is re-rendering for new filters. The list is
// already dimmed; this adds a small spinner (after the same 120ms delay as
// navigation, so quick updates don't flash) and a polite announcement.
// Drawn as a small ring holding the orbit glyph (.lm-updating, overlays.css).
export function Updating() {
  return (
    <span role="status" className="nav-pending pointer-events-none absolute right-0 top-0 z-10 flex items-center">
      <span aria-hidden className="lm-updating">
        <Spinner size="sm" />
      </span>
      <span className="sr-only">Updating results…</span>
    </span>
  );
}
