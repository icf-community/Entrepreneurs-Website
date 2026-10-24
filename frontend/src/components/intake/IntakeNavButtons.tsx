import { Button } from "@/components/ui/Button";

/** The Back/Continue footer nav — extracted out of IntakeFlow's render
 *  (structural only, no behavior change) to keep that component's size
 *  and complexity down. */
export function IntakeNavButtons({
  onBack,
  onNext,
  backDisabled,
  busy,
  isLast,
}: {
  onBack: () => void;
  onNext: () => void;
  backDisabled: boolean;
  busy: boolean;
  isLast: boolean;
}) {
  return (
    <div className="mt-8 flex items-center gap-3 border-t border-border-subtle pt-6">
      <Button
        type="button"
        variant="ghost"
        size="md"
        onClick={onBack}
        disabled={backDisabled || busy}
        className={backDisabled ? "invisible" : ""}
      >
        ← Back
      </Button>

      <span className="flex-1" />

      <Button type="button" variant="primary" size="md" onClick={onNext} loading={busy}>
        {isLast ? "Finish →" : "Continue →"}
      </Button>
    </div>
  );
}
