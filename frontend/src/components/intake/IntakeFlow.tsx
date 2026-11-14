"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/Button";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { ErrorBanner } from "@/components/forms/Banners";
import type { ChipItem } from "@/components/forms/ChipGroup";
import type { DirectoryMember } from "@/lib/data/directory";
import type { SkillOption } from "./controls";
import { createClient } from "@/lib/supabase/client";
import { describeSupabaseError, isSessionExpiredError } from "@/lib/supabaseErrors";
import {
  ORDER,
  STEPS,
  TOTAL_SCREENS,
  completeness,
  indexOf,
  type Affiliation,
  type StepId,
} from "@/lib/intake/steps";
import { track } from "@/lib/analytics/track";
import { MIN_SKILLS, initialState, type IntakeState } from "@/lib/intake/state";
import { useIntakeDraft } from "@/lib/intake/useIntakeDraft";
import StepRail, { StepRailDisclosure } from "./StepRail";
import { useGithubConnectFlow } from "./useGithubConnectFlow";
import { useCvUpload } from "./useCvUpload";
import { useAvatarUpload } from "./useAvatarUpload";
import { useLinkedinSave } from "./useLinkedinSave";
import { useSkipConsentWarnings } from "./useSkipConsentWarnings";
import { IntakeStepBody } from "./IntakeStepBody";
import { IntakeWarningDialogs } from "./IntakeWarningDialogs";
import { IntakeDoneScreen } from "./IntakeDoneScreen";
import { IntakeProgressBar } from "./IntakeProgressBar";
import { IntakeNavButtons } from "./IntakeNavButtons";
import type { ExistingCv, ScreenProps } from "./screens";

// ════════════════════════════════════════════════════════════════════
// Foundry · Post-approval intake
//
// Runs once, after admission — identity was already collected at
// /onboarding and fed the admin review queue before this ever mounts.
//
// Most screens are skippable via the button in the header, which calls
// defer_intake() and lands on /home — but CV (for a student) and
// LinkedIn (for everyone) are compulsory, and "Skip for now" is hidden
// entirely until both are already saved on the profile row. See
// compulsoryDone below and 20260901000013's header comment for the
// server-side half of this — defer_intake and submit_intake both raise
// if a compulsory item is missing, so the client hiding the button is
// UX only, not the actual enforcement.
//
// Avatar and CV each own a real round trip to the upload gateway,
// centralised here rather than inside the screens: screens.tsx stays
// pure UI (patch state, nothing else), and every "bytes leave the
// browser" moment lives in one file. The avatar uploads the moment a
// crop is confirmed (screen 01); the CV uploads when the member
// continues past screen 02 — see uploadCv below for why that one waits.
// LinkedIn is saved (via set_my_linkedin) at that same moment, for the
// same reason: "already saved" needs to be a real, server-checkable
// fact as soon as it's true, not only after Finish.
// ════════════════════════════════════════════════════════════════════

// react-doctor-disable-next-line react-doctor/no-giant-component -- already split everything separable (GitHub/CV/LinkedIn/avatar round trips, warning dialogs, step body, nav buttons, rail) into their own hooks/components; what remains (validate/go/finish/next/advance/back/skip) is one interdependent step-wizard state machine closing over nearly all local state — splitting it further relocates coupling rather than reducing it, and risks behavior drift in the onboarding flow for a line-count metric alone
export default function IntakeFlow({
  memberId,
  firstName,
  skillTaxonomy,
  sectors,
  matches,
  existingAvatarUrl,
  role,
  gradYear,
  existingLinkedin,
  existingCv,
  existingGithubUrl,
  githubConnected,
  ingestionEnabled,
}: {
  memberId: string;
  firstName: string;
  skillTaxonomy: SkillOption[];
  sectors: ChipItem[];
  matches: DirectoryMember[];
  existingAvatarUrl: string | null;
  role: Affiliation;
  gradYear: number | null;
  existingLinkedin: string | null;
  existingCv: ExistingCv | null;
  existingGithubUrl: string | null;
  githubConnected: boolean;
  /** Kill switch (20260911000003) — false pauses only the LLM/worker-job
   *  side of CV upload and GitHub connect; file storage and OAuth
   *  recording stay unaffected either way. */
  ingestionEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [s, setS] = useState<IntakeState>(() => initialState({
    preferredName: firstName,
    photoPreview: existingAvatarUrl,
    cvUploadedKey: existingCv?.blobKey ?? null,
    cvOriginalFilename: existingCv?.filename ?? null,
    linkedin: existingLinkedin,
  }));
  const clearDraft = useIntakeDraft(memberId, s, setS);
  // The OAuth return lands on /intake?github=connected|error. Reading it
  // here rather than setting `step` from an effect is not a lint dodge:
  // an effect would render the face screen for one frame and then jump,
  // which reads as the flow restarting after a member has just come back
  // from github.com.
  const githubReturn = searchParams.get("github");
  const [step, setStep] = useState<StepId>(
    githubReturn === "connected" || githubReturn === "error" ? "github" : "face",
  );
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // ─── GitHub (optional, screen 03) ─────────────────────────────────
  // Owned in a hook rather than in screens.tsx for the same reason the
  // avatar and CV uploads are owned here: screens.tsx stays pure UI, and
  // every round trip lives in one place.
  const { ghConnected, github } = useGithubConnectFlow(githubConnected, githubReturn, router);

  // These RPCs run straight from the browser client, so there is no
  // framework-level redirect on an expired session the way a page load or
  // server action gets — send them back to sign in rather than leaving them
  // to notice the banner. Brief delay so the message above is readable
  // before the page navigates away.
  const bounceIfSessionExpired = (rpcError: Parameters<typeof isSessionExpiredError>[0]) => {
    if (isSessionExpiredError(rpcError)) {
      window.setTimeout(() => router.push("/login"), 1500);
    }
  };

  const { linkedinSaved, saveLinkedin } = useLinkedinSave(supabase, existingLinkedin, bounceIfSessionExpired);

  const {
    skipWarningFor,
    setSkipWarningFor,
    markSkipWarned,
    consentWarningFor,
    setConsentWarningFor,
    markConsentWarned,
    shouldWarnAboutSkipping,
    shouldWarnAboutConsent,
  } = useSkipConsentWarnings(role, s, ghConnected);

  /** Every compulsory item for this role is already saved on the profile
   *  row — the gate for showing "Skip for now" at all. */
  const compulsoryDone = (role !== "student" || !!s.cvUploadedKey) && linkedinSaved;

  const patch = (p: Partial<IntakeState>) => setS((prev) => ({ ...prev, ...p }));

  const idx = indexOf(step);
  const meta = STEPS[step];
  const isLast = idx === TOTAL_SCREENS - 1;

  useEffect(() => {
    return () => {
      if (s.photoPreview) URL.revokeObjectURL(s.photoPreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
  }, []);

  // The bare step-transition primitive `go()` itself needs below (set
  // error/direction/step, scroll to top) with none of its suggestion-arming
  // logic — declared here, ahead of useCvUpload, purely so that hook's
  // goBackToCv thunk has something to call without a forward reference to
  // `go` (which depends on useCvUpload's own return values).
  const goToStep = (to: StepId, direction: "fwd" | "back") => {
    setError("");
    setDir(direction);
    setStep(to);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" });
  };

  // CV upload, the bounded background-suggestion poll, and the reject
  // flow — see useCvUpload for why these own a round trip here rather
  // than in screens.tsx.
  const {
    suggestionsLoading,
    setSuggestionsLoading,
    suggestionsGaveUp,
    rejectingCv,
    uploadCv,
    rejectCv,
  } = useCvUpload(supabase, step, s, patch, () => goToStep("cv", "back"), setError);

  const { avatarUploading, avatarError, onCropAvatar } = useAvatarUpload(patch, s.photoPreview);

  const validate = (id: StepId): string | null => {
    if (id === "cv") {
      if (role === "student" && !s.cvFile && !s.cvUploadedKey) {
        return "Add your CV to continue — it's what powers your matches with recruiters.";
      }
      const lk = s.linkedin.trim();
      if (!lk) {
        return "Add your LinkedIn profile to continue.";
      }
      if (!/^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(lk)) {
        return "That doesn't look like a LinkedIn URL.";
      }
    }
    if (id === "skills") {
      if (s.skillIds.length > 0 && s.skillIds.length < MIN_SKILLS) {
        return `Add at least ${MIN_SKILLS} skills, or skip this for now from the header.`;
      }
    }
    return null;
  };

  const go = (to: StepId, direction: "fwd" | "back") => {
    // Arms the same bounded poll the CV-upload branch of advance() starts
    // — but also covers arriving here any other way (the rail lets you
    // jump to any screen, visited or not; so does Back). Without this, a
    // member who left "skills" mid-poll (or before ever polling) and
    // came back via the rail saw a permanently empty box even once
    // cv_suggested_skill_ids was sitting on the row. Only the first visit
    // auto-fetches — !suggestionsGaveUp keeps this from re-arming itself
    // on every rail click after a member has already used the manual
    // "Check again" retry once.
    if (
      to === "skills" &&
      s.suggestedSkillIds.length === 0 &&
      s.cvConsent && (s.cvFile || s.cvUploadedKey) &&
      !suggestionsLoading && !suggestionsGaveUp
    ) {
      setSuggestionsLoading(true);
    }
    goToStep(to, direction);
  };

  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("submit_intake", {
        p_preferred_name: s.preferredName.trim() || null,
        p_bio_focus: s.bioFocus.trim() || null,
        p_bio_hobbies: s.bioHobbies.trim() || null,
        p_current_focus: s.currentFocus || null,
        p_venture_stage: s.ventureStage || null,
        p_venture_name: s.ventureName.trim() || null,
        p_venture_url: s.ventureUrl.trim() || null,
        p_venture_one_liner: s.ventureOneLiner.trim() || null,
        p_recruiting_status: s.recruitingStatus || null,
        p_intent_urgency: s.intentUrgency || null,
        p_availability_hours: s.availabilityHours || null,
        p_skill_ids: s.skillIds,
        p_core_skill_ids: s.coreSkillIds,
        p_sector_ids: s.sectorIds,
        p_academic_interests: s.academicInterests,
        p_hobbies: s.hobbies,
        p_intents: s.intents,
      });
      if (rpcError) { setError(describeSupabaseError(rpcError)); bounceIfSessionExpired(rpcError); return; }
      // Saved separately and best-effort: a failure here must not lose the
      // intake that just succeeded, and /opportunities asks again.
      if (s.currentlyEnrolled && s.completedDegree) {
        const { error: eduError } = await supabase.rpc("set_my_education", {
          p_currently_enrolled: s.currentlyEnrolled === "yes",
          p_has_completed_degree: s.completedDegree === "yes",
        });
        if (eduError) console.error("Failed to save education status:", eduError);
      }
      clearDraft();
      track("intake_completed");
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    const validationError = validate(step);
    if (validationError) { setError(validationError); return; }

    if (shouldWarnAboutConsent(step)) {
      markConsentWarned();
      setConsentWarningFor(step);
      return;
    }

    if (shouldWarnAboutSkipping(step)) {
      markSkipWarned(step);
      setSkipWarningFor(step);
      return;
    }

    await advance();
  };

  const advance = async () => {
    if (step === "cv") {
      setBusy(true);
      try {
        const uploadError = await uploadCv();
        if (uploadError) { setError(uploadError); return; }
        const linkedinError = await saveLinkedin(s.linkedin);
        if (linkedinError) { setError(linkedinError); return; }
        // Triggered here, not read back from s.cvUploadedKey in go() — that
        // field is set by uploadCv()'s own patch() call above, which hasn't
        // flowed through a re-render yet, so this closure's s.cvUploadedKey
        // would still read stale (null) for a fresh upload. s.cvFile is the
        // reliable "there is a CV to show suggestions for" signal instead:
        // it was set by an earlier, already-committed render, not this call.
        if (s.cvConsent && (s.cvFile || s.cvUploadedKey) && s.suggestedSkillIds.length === 0) {
          setSuggestionsLoading(true);
        }
      } finally {
        setBusy(false);
      }
    }

    if (isLast) {
      await finish();
    } else {
      go(ORDER[idx + 1], "fwd");
    }
  };

  const back = () => {
    if (idx > 0) go(ORDER[idx - 1], "back");
  };

  const skip = async () => {
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc("defer_intake");
      // defer_intake itself enforces compulsoryDone server-side (see
      // 20260901000013) — this error path is the real backstop, not just
      // defensive styling, in case the button was ever shown when it
      // shouldn't have been.
      if (rpcError) { setError(describeSupabaseError(rpcError)); bounceIfSessionExpired(rpcError); return; }
      clearDraft();
      router.push("/home");
    } finally {
      setBusy(false);
    }
  };

  const pct = useMemo(() => completeness(step), [step]);

  const screenProps: ScreenProps = {
    s, patch, firstName, skillTaxonomy, sectors,
    avatarUploading, avatarError, onCropAvatar, existingCv,
    role, gradYear, existingLinkedin, suggestionsLoading, suggestionsGaveUp, rejectingCv, onRejectCv: rejectCv,
    existingGithubUrl, ingestionEnabled,
    github,
  };

  // STEPS.cv.title is static and reads "if you have one" — wrong for a student, for whom the paragraph right below it says the
  // opposite. Only this one screen's heading needs to be role-aware; everything else can keep reading straight from steps.ts.
  const heading = step === "cv" ? (role === "student" ? "Your CV" : "Your CV, if you have one") : meta.title;
  const enter = dir === "fwd" ? "anim-step-fwd" : "anim-step-back";

  return (
    // no background of its own: the atmosphere (the night behind every page) shows through
    <div className="flex min-h-screen flex-col">
      <header className="z-40 border-b border-border-subtle bg-bg-primary/85 px-[var(--gutter)] backdrop-blur-md sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[var(--content-max)] flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
          <Link href="/" className="no-underline">
            <BrandLogo size="sm" />
          </Link>
          {!done && compulsoryDone && (
            <Button type="button" variant="ghost" size="sm" onClick={skip} disabled={busy}>
              Skip for now
            </Button>
          )}
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-[var(--gutter)] pb-24 pt-6 lg:pt-10"
      >
        {done ? (
          <IntakeDoneScreen onGoToDashboard={() => router.push("/home")} />
        ) : (
          <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
            <aside className="hidden lg:block">
              {/* sticky, and level with the masthead's first line */}
              <div className="sticky top-[calc(var(--appbar-height)+2.5rem)] pt-[28px]">
                <StepRail current={step} onJump={(to) => go(to, "back")} />
              </div>
            </aside>

            <div className="min-w-0 max-w-[44rem]">
              {/* the heading and the card each enter from the side you are travelling toward; the progress between them stays
                  put, so its fill and its point of light can move */}
              <div key={`${step}-head`} className={enter}>
                {step !== "youre-in" ? (
                  <PageHead context={meta.eyebrow} title={heading} />
                ) : (
                  // this screen draws its own "Welcome" and greeting; the eyebrow stays in the page for a screen reader, as it always was
                  <p className="sr-only">{meta.eyebrow}</p>
                )}
              </div>

              <div className="my-7">
                <IntakeProgressBar pct={pct} />
              </div>

              <div key={`${step}-body`} className={enter}>
                {error && (
                  <div className="mb-6">
                    <ErrorBanner>{error}</ErrorBanner>
                  </div>
                )}

                {/* the "You're in" screen is a moment, not a form: its cards are the surfaces, so it gets no card of its own */}
                {step === "youre-in" ? (
                  <IntakeStepBody step={step} screenProps={screenProps} matches={matches} />
                ) : (
                  <Panel className="p-6 sm:p-8">
                    <IntakeStepBody step={step} screenProps={screenProps} matches={matches} />
                  </Panel>
                )}

                <IntakeWarningDialogs
                  skipWarningFor={skipWarningFor}
                  onDismissSkip={() => setSkipWarningFor(null)}
                  onSkipAnyway={() => { setSkipWarningFor(null); void advance(); }}
                  consentWarningFor={consentWarningFor}
                  onDismissConsent={() => setConsentWarningFor(null)}
                  onContinueWithoutConsent={() => { setConsentWarningFor(null); void advance(); }}
                />
              </div>

              <IntakeNavButtons
                onBack={back}
                onNext={next}
                backDisabled={idx === 0}
                busy={busy}
                isLast={isLast}
              />

              <StepRailDisclosure className="mt-10 lg:hidden" current={step} onJump={(to) => go(to, "back")} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
