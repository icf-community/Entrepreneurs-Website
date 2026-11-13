/** The thin completeness progress bar above each screen — extracted
 *  out of IntakeFlow's render (structural only, no behavior change) to
 *  keep that component's size and complexity down. */
export function IntakeProgressBar({ pct }: { pct: number }) {
  return (
    <div className="mb-8 flex items-center gap-4">
      <div
        className="h-px flex-1 bg-border"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile completeness"
      >
        <div
          className="h-px bg-signal transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-small text-text-muted">
        {pct}% profile complete
      </span>
    </div>
  );
}
