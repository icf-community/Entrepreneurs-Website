import { Button } from "@/components/ui/Button";

/** The terminal "All set." screen shown after finish() succeeds —
 *  extracted out of IntakeFlow's render (structural only, no behavior
 *  change) to keep that component's size and complexity down. */
export function IntakeDoneScreen({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  return (
    <div className="mx-auto max-w-[46ch] text-center">
      <span aria-hidden className="mx-auto mb-6 block h-3 w-3 rotate-45 rounded-[1px] bg-signal" />
      <h1 className="mb-4 font-display text-display leading-[1.1] tracking-tight text-text-primary">
        All set.
      </h1>
      <p className="mb-8 text-lead leading-[1.65] text-text-secondary">
        You can change any of this any time from My Profile.
      </p>
      <Button type="button" variant="primary" size="md" onClick={onGoToDashboard}>
        Go to your dashboard →
      </Button>
    </div>
  );
}
