import { Button } from "@/components/ui/Button";
import { Icon } from "@/design-system/icons/Icon";

// The pair at the large size's side padding is 307 px wide and a 320 px screen leaves the row 280, so Continue ran 27 px out of the page.
// Below 360 px the side padding steps down to 20 px (the pair is then 267) and the two stay Back at the left, Continue at the right.
const FIT = "max-[359px]:px-4";

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
        size="lg"
        onClick={onBack}
        disabled={backDisabled || busy}
        className={`${FIT} ${backDisabled ? "invisible" : ""}`}
        leading={<Icon name="arrow-left" size={16} />}
      >
        <span className="sr-only">← </span>
        Back
      </Button>

      <span className="flex-1" />

      {/* the last screen's action is the one thing the whole flow exists for: it is the lit one */}
      <Button type="button" variant="primary" size="lg" onClick={onNext} loading={busy} lit={isLast} className={FIT}>
        {isLast ? "Finish" : "Continue"}
        <span className="sr-only"> →</span>
        <Icon name="arrow-right" size={16} />
      </Button>
    </div>
  );
}
