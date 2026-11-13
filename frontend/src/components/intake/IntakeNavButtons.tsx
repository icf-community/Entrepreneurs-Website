import { Button } from "@/components/ui/Button";
import { Icon } from "@/design-system/icons/Icon";

/** The Back/Continue footer nav — extracted out of IntakeFlow's render
 *  (structural only, no behavior change) to keep that component's size
 *  and complexity down.
 *
 *  The arrows are drawn icons; the characters stay in the buttons' names as visually hidden text, so
 *  they are still "← Back", "Continue →" and "Finish →" to a screen reader and to anything that finds them by name. */
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
        leading={<Icon name="arrow-left" size={16} />}
      >
        <span className="sr-only">← </span>
        Back
      </Button>

      <span className="flex-1" />

      {/* the last screen's action is the one thing the whole flow exists for: it is the lit one */}
      <Button type="button" variant="primary" size="md" onClick={onNext} loading={busy} lit={isLast}>
        {isLast ? "Finish" : "Continue"}
        <span className="sr-only"> →</span>
        <Icon name="arrow-right" size={16} />
      </Button>
    </div>
  );
}
