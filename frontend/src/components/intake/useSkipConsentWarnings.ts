import { useRef, useState } from "react";
import type { Affiliation, StepId } from "@/lib/intake/steps";
import type { IntakeState } from "@/lib/intake/state";

/**
 * Skip/consent-warning dialog state for the CV and GitHub screens —
 * extracted out of IntakeFlow (structural only, no behavior change) to
 * keep that component's size and complexity down.
 */
export function useSkipConsentWarnings(role: Affiliation, s: IntakeState, ghConnected: boolean) {
  // Shown once per screen per session. A member who presses Continue a
  // second time has read it and decided; nagging again is just friction.
  const [skipWarningFor, setSkipWarningFor] = useState<StepId | null>(null);
  // Ref, not state: only ever read/written from event-handler logic
  // (shouldWarnAboutSkipping/next), never from render output, so tracking
  // it in state would just trigger a pointless re-render.
  const skipWarned = useRef<Set<StepId>>(new Set());
  // Separate from skipWarned/skipWarningFor: this one fires for a CV
  // that IS attached but unconsented, including for a student, where
  // shouldWarnAboutSkipping deliberately never fires (see its own
  // comment) — a different problem needs a different warning.
  const [consentWarningFor, setConsentWarningFor] = useState<StepId | null>(null);
  // Ref for the same reason as skipWarned above: read/written only from
  // shouldWarnAboutConsent/next, never from render output.
  const consentWarned = useRef(false);

  /**
   * True when the member is about to leave the CV or GitHub screen
   * having supplied NEITHER, and both are genuinely optional for them.
   *
   * Never fires for a student on the CV screen: their CV is compulsory
   * (20260901000013), so a missing one hits validate()'s hard error and
   * a dismissible "are you sure?" would imply a choice that isn't there.
   */
  const shouldWarnAboutSkipping = (id: StepId): boolean => {
    if (id !== "cv" && id !== "github") return false;
    if (skipWarned.current.has(id)) return false;
    if (id === "cv" && role === "student") return false;
    const hasCv = !!s.cvFile || !!s.cvUploadedKey;
    return !hasCv && !ghConnected;
  };

  /**
   * True when leaving the CV screen with a file attached but
   * cvConsent unticked — confirm_cv_upload (20260906000001) only opens
   * a cvs row, and so only runs any of the recruiter-matching pipeline,
   * when that box is ticked. This satisfies validate()'s "a CV is
   * present" check for a compulsory student CV while doing nothing the
   * requirement exists for, and nothing else would ever say so — unlike
   * shouldWarnAboutSkipping, this fires for students too.
   */
  const shouldWarnAboutConsent = (id: StepId): boolean => {
    if (id !== "cv") return false;
    if (consentWarned.current) return false;
    const hasCv = !!s.cvFile || !!s.cvUploadedKey;
    return hasCv && !s.cvConsent;
  };

  const markSkipWarned = (id: StepId) => {
    skipWarned.current.add(id);
  };

  const markConsentWarned = () => {
    consentWarned.current = true;
  };

  return {
    skipWarningFor,
    setSkipWarningFor,
    markSkipWarned,
    consentWarningFor,
    setConsentWarningFor,
    markConsentWarned,
    shouldWarnAboutSkipping,
    shouldWarnAboutConsent,
  };
}
