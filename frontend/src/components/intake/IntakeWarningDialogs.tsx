import type { StepId } from "@/lib/intake/steps";
import { SkipWarningDialog } from "./SkipWarningDialog";
import { ConsentWarningDialog } from "./ConsentWarningDialog";

/** The skip/consent "are you sure?" dialogs — extracted out of
 *  IntakeFlow's render (structural only, no behavior change) to keep
 *  that component's size and complexity down. */
export function IntakeWarningDialogs({
  skipWarningFor,
  onDismissSkip,
  onSkipAnyway,
  consentWarningFor,
  onDismissConsent,
  onContinueWithoutConsent,
}: {
  skipWarningFor: StepId | null;
  onDismissSkip: () => void;
  onSkipAnyway: () => void;
  consentWarningFor: StepId | null;
  onDismissConsent: () => void;
  onContinueWithoutConsent: () => void;
}) {
  return (
    <>
      {skipWarningFor && (
        <SkipWarningDialog onAddNow={onDismissSkip} onSkip={onSkipAnyway} />
      )}

      {consentWarningFor && (
        <ConsentWarningDialog onTickNow={onDismissConsent} onContinueAnyway={onContinueWithoutConsent} />
      )}
    </>
  );
}
