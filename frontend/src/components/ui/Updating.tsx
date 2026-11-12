// C2: shown over a list that is re-rendering for new filters. The list is
// already dimmed; this adds a small spinner (after the same 120ms delay as
// navigation, so quick updates don't flash) and a polite announcement.
export function Updating() {
  return (
    <span role="status" className="nav-pending pointer-events-none absolute right-0 top-0 z-10 flex items-center gap-2 text-[0.75rem] text-text-muted">
      <span aria-hidden className="h-3.5 w-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
      <span className="sr-only">Updating results…</span>
    </span>
  );
}
