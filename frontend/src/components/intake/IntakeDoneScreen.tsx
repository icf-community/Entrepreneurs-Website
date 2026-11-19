import { Button } from "@/components/ui/Button";
import { MeterGlyph } from "@/components/ui/Meter";
import { Icon } from "@/design-system/icons/Icon";

/** The terminal "All set." screen shown after finish() succeeds —
 *  extracted out of IntakeFlow's render (structural only, no behavior
 *  change) to keep that component's size and complexity down.
 *
 *  The progress hairline ran to 100%; here it is a ring, closed. */
export function IntakeDoneScreen({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  return (
    <div className="mx-auto max-w-[46ch] py-10 text-center sm:py-16">
      <div className="mb-8 flex justify-center">
        <span className="relative inline-grid place-items-center text-accent-light">
          <MeterGlyph value={100} size="lg" />
          <span className="absolute inset-0 grid place-items-center">
            <Icon name="check" size={24} />
          </span>
        </span>
      </div>
      <h1 className="mb-4 font-display text-display text-text-primary">
        All set.
      </h1>
      <p className="mb-9 text-body leading-[1.6] text-text-secondary">
        You can change any of this any time from My Profile.
      </p>
      <Button type="button" variant="primary" size="lg" lit onClick={onGoToDashboard}>
        Go to your dashboard
        <span className="sr-only"> →</span>
        <Icon name="arrow-right" size={16} />
      </Button>
    </div>
  );
}
