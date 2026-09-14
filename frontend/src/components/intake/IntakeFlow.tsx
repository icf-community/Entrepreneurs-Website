"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";
import type { ChipItem } from "@/components/forms/ChipGroup";
import type { DirectoryMember } from "@/lib/data/directory";
import type { SkillOption } from "./controls";
import { createClient } from "@/lib/supabase/client";
import { describeSupabaseError, isSessionExpiredError } from "@/lib/supabaseErrors";
import {
  requestAvatarTicket,
  confirmAvatarUpload,
  requestCvTicket,
  confirmCvUpload,
  removeCv,
  getMyGithubStatus,
  getMyGithubShowcase,
  setMyGithubShowcase,
} from "@/app/profile/mediaActions";
import {
  GROUPS,
  ORDER,
  STEPS,
  TOTAL_SCREENS,
  completeness,
  indexOf,
  type Affiliation,
  type StepId,
} from "@/lib/intake/steps";
import { track } from "@/components/analytics/PostHogProvider";
import { MIN_SKILLS, initialState, type IntakeState } from "@/lib/intake/state";
import { useIntakeDraft } from "@/lib/intake/useIntakeDraft";
import StepRail from "./StepRail";
import { SkipWarningDialog } from "./SkipWarningDialog";
import { ConsentWarningDialog } from "./ConsentWarningDialog";
import {
  CvScreen,
  FaceScreen,
  GithubScreen,
  InterestsScreen,
  SkillsScreen,
  WantScreen,
  WhereScreen,
  YoureInScreen,
  type ExistingCv,
  type GithubScreenState,
  type ScreenProps,
} from "./screens";

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

export default function IntakeFlow({
  memberId,
  firstName,
  skillTaxonomy,
  sectors,
  matches,
  existingAvatarUrl,
  role,
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

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  // Whether LinkedIn is actually persisted server-side, not just typed
  // into the field — seeded from the server prop, then flipped true by
  // saveLinkedin() below. Deliberately NOT derived from s.linkedin: a
  // localStorage draft can rehydrate typed-but-never-sent text, and
  // that must not unlock Skip on its own (see the user correction this
  // whole gate exists for — 20260901000013's header comment).
  const [linkedinSaved, setLinkedinSaved] = useState(!!existingLinkedin);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // Set only when the bounded poll below exhausts its attempts with
  // nothing found. We can't distinguish "slow extraction" from "this
  // wasn't a CV we could read" from here, and the product call is to
  // treat it as the latter: ask for the right document back rather than
  // leave someone polling indefinitely on a maybe-bad upload.
  const [suggestionsGaveUp, setSuggestionsGaveUp] = useState(false);
  // True while rejectCv's removeCv() round trip is in flight — disables
  // the reject button so a slow connection can't fire it twice.
  const [rejectingCv, setRejectingCv] = useState(false);

  // ─── GitHub (optional, screen 03) ─────────────────────────────────
  // Owned here rather than in screens.tsx for the same reason the avatar
  // and CV uploads are: screens.tsx stays pure UI, and every round trip
  // lives in one file.
  const [ghConnected, setGhConnected] = useState(githubConnected);
  const [ghScanning, setGhScanning] = useState(false);
  const [ghConnecting, setGhConnecting] = useState(false);
  const [ghError, setGhError] = useState(
    githubReturn === "error" ? "We couldn't connect your GitHub account. Please try again." : "",
  );
  const [ghShowcase, setGhShowcase] = useState<GithubScreenState["showcase"]>(null);
  const [ghSaving, setGhSaving] = useState(false);
  const [ghSaved, setGhSaved] = useState(false);

  // Shown once per screen per session. A member who presses Continue a
  // second time has read it and decided; nagging again is just friction.
  const [skipWarningFor, setSkipWarningFor] = useState<StepId | null>(null);
  const [skipWarned, setSkipWarned] = useState<Set<StepId>>(() => new Set());
  // Separate from skipWarned/skipWarningFor: this one fires for a CV
  // that IS attached but unconsented, including for a student, where
  // shouldWarnAboutSkipping deliberately never fires (see its own
  // comment) — a different problem needs a different warning.
  const [consentWarningFor, setConsentWarningFor] = useState<StepId | null>(null);
  const [consentWarned, setConsentWarned] = useState(false);

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

  /**
   * confirmCvUpload's background extraction (see mediaActions.ts) usually
   * finishes well before the member reaches this screen, but not always
   * — there's no completion signal to wait on, only a column to poll.
   * Bounded so a slow or failed extraction doesn't spin forever: up to
   * 6 tries, 1.5s apart (~9s), with a loading state so the screen shows
   * "reading your CV" instead of looking blank while it waits.
   *
   * suggestionsLoading is set to true in next()'s cv-branch, right after
   * a successful upload/save — not synchronously in this effect, which
   * is the react-hooks/set-state-in-effect trap this codebase already
   * hit once (see AvatarCropper's history). This effect only polls and
   * turns it back off; the guard below just means "a poll is needed and
   * hasn't finished yet" — it also naturally resumes if the member
   * leaves "skills" mid-poll and comes back (the effect re-runs on the
   * step change, and suggestionsLoading is still true from before).
   */
  useEffect(() => {
    if (step !== "skills" || !suggestionsLoading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const MAX_ATTEMPTS = 6;
    const INTERVAL_MS = 1500;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      const { data } = await supabase.rpc("get_my_cv_info").maybeSingle();
      if (cancelled) return;
      const ids = data?.cv_suggested_skill_ids;
      if (ids && ids.length > 0) {
        patch({ suggestedSkillIds: ids });
        setSuggestionsLoading(false);
        setSuggestionsGaveUp(false);
        return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        setSuggestionsLoading(false);
        setSuggestionsGaveUp(true);
        return;
      }
      timer = setTimeout(poll, INTERVAL_MS);
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll while go() has flagged loading for this arrival at "skills"
  }, [step, suggestionsLoading]);

  /**
   * Polls the scan the way the profile dialog does, then loads the
   * picker. Bounded: a scan that hasn't finished within ~40s leaves the
   * screen saying so and lets the member move on — an optional screen
   * must never be able to trap someone mid-signup.
   */
  const loadGithub = useCallback(async () => {
    setGhScanning(true);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await getMyGithubStatus();
      if (!status.ok || !status.data) break;
      setGhConnected(true);
      if (status.data.scanStatus === "failed") {
        setGhError(status.data.scanFailureReason ?? "We couldn't read your repositories.");
        setGhScanning(false);
        return;
      }
      if (status.data.scanStatus === "ready") {
        const showcase = await getMyGithubShowcase();
        if (showcase.ok && showcase.data) setGhShowcase(showcase.data);
        setGhScanning(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setGhScanning(false);
  }, []);

  /**
   * The OAuth round trip leaves the flow entirely and comes back to
   * /intake?github=connected. The draft in localStorage restores every
   * answer, but `step` is deliberately NOT drafted — which is exactly
   * why the query param has to carry it. Cleared with router.replace so
   * a later refresh doesn't re-trigger this.
   */
  useEffect(() => {
    if (githubReturn !== "connected" && githubReturn !== "error") return;
    // Clear the param so a refresh doesn't re-enter this branch. The step
    // and the error message are already in the initial state above.
    router.replace("/intake");
    // Genuinely does set state synchronously: loadGithub's first line is
    // setGhScanning(true), before it polls. That is the point — the
    // screen must already read as scanning when the member lands back
    // from github.com, not one poll later. The cost is one extra render
    // on a mount that is navigating anyway.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (githubReturn === "connected") void loadGithub();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the OAuth return
  }, []);

  // A plain navigation to a Route Handler, not a Server Action call —
  // see auth/github-connect/start/route.ts's header comment for why:
  // a Server Action here raced Next's own RSC reconciliation and
  // flashed error.tsx before the real redirect completed. Failure
  // comes back as ?github=error, read by the effect above (githubReturn).
  const connectGithub = () => {
    setGhConnecting(true);
    // A hard navigation on purpose — router.push() would soft-navigate
    // within the SPA instead of making the real GET request this Route
    // Handler needs to run its guards and set-then-redirect.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/auth/github-connect/start?returnTo=intake";
  };

  const saveGithubPicks = async (picks: { name: string; blurb: string }[]) => {
    setGhError("");
    setGhSaving(true);
    const result = await setMyGithubShowcase(picks);
    setGhSaving(false);
    if (!result.ok) { setGhError(result.error); return; }
    setGhSaved(true);
  };

  const onCropAvatar = async (blob: Blob) => {
    setAvatarError("");
    setAvatarUploading(true);
    try {
      const ticket = await requestAvatarTicket();
      if (!ticket.ok) { setAvatarError(ticket.error); return; }

      const form = new FormData();
      form.append("file", blob, "avatar.jpg");
      const res = await fetch(ticket.data.uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.data.token}` },
        body: form,
        // Without this, a hung gateway leaves avatarUploading stuck true
        // forever with no error — the catch below never fires.
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setAvatarError(detail?.detail ?? "That photo couldn't be uploaded. Try a JPEG, PNG or WebP.");
        return;
      }
      const stored = await res.json();

      const confirmed = await confirmAvatarUpload(stored.key);
      if (!confirmed.ok) { setAvatarError(confirmed.error); return; }

      if (s.photoPreview) URL.revokeObjectURL(s.photoPreview);
      patch({ photoPreview: URL.createObjectURL(blob) });
    } catch {
      setAvatarError("Couldn't reach the photo service. Try again in a moment.");
    } finally {
      setAvatarUploading(false);
    }
  };

  /**
   * Uploads the CV chosen on screen 02, only when the member continues
   * past it (not on file pick) — picking a file the member then decides
   * not to keep should never cost a round trip. Runs at most once per
   * file: cvUploadedKey guards against re-uploading on Back → Continue.
   */
  const uploadCv = async (): Promise<string | null> => {
    if (!s.cvFile || s.cvUploadedKey) return null;

    const ticket = await requestCvTicket();
    if (!ticket.ok) return ticket.error;

    try {
      const form = new FormData();
      form.append("file", s.cvFile);
      const res = await fetch(ticket.data.uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.data.token}` },
        body: form,
        // Without this, a hung gateway hangs the Continue button forever
        // with no error — see the same fix on onCropAvatar above.
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        return detail?.detail ?? "That file couldn't be uploaded. Try a PDF or DOCX.";
      }
      const stored = await res.json();

      const confirmed = await confirmCvUpload(stored.key, s.cvFile.name, s.cvConsent);
      if (!confirmed.ok) return confirmed.error;

      // Suggestion chips are no longer returned inline — confirmCvUpload
      // parses the CV in the background and persists the result, so a
      // fresh upload clears whatever the previous CV suggested until the
      // effect below picks up the new value once the Skills screen mounts.
      //
      // This is also the one point that "a replacement CV is actually
      // uploaded" (as opposed to just clicking "Upload a different CV"
      // and reconsidering) — so it's where stale CV-sourced skills from
      // whatever CV was on file before get dropped. cvSkillIds only ever
      // contains ids added via acceptSuggestion (screens.tsx), never
      // ones the member searched for and added themselves, so this never
      // touches a manually-added skill. On a first-ever upload
      // cvSkillIds is already empty, so the filter is a no-op there.
      patch({
        cvUploadedKey: stored.key,
        cvOriginalFilename: s.cvFile.name,
        suggestedSkillIds: [],
        skillIds: s.skillIds.filter((id) => !s.cvSkillIds.includes(id)),
        coreSkillIds: s.coreSkillIds.filter((id) => !s.cvSkillIds.includes(id)),
        cvSkillIds: [],
      });
      return null;
    } catch {
      // Network error or the timeout above firing — this call previously had
      // no catch at all, so either one was an unhandled rejection.
      return "Couldn't reach the file service. Try again in a moment.";
    }
  };

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

  /**
   * Persists LinkedIn the moment the member continues past the CV
   * screen — not bundled into Finish — so compulsoryDone reflects a
   * real, server-checked fact as soon as it's true. Always calls
   * through rather than diffing against existingLinkedin: the RPC is a
   * cheap single-column write, and this only runs once per Continue.
   */
  const saveLinkedin = async (): Promise<string | null> => {
    const { error: rpcError } = await supabase.rpc("set_my_linkedin", {
      p_linkedin_url: s.linkedin.trim(),
    });
    if (rpcError) { bounceIfSessionExpired(rpcError); return describeSupabaseError(rpcError); }
    setLinkedinSaved(true);
    return null;
  };

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
    setError("");
    setDir(direction);
    setStep(to);
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
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" });
  };

  /**
   * "We couldn't find any matching skills in that document" — offered
   * once the poll above gives up. Rather than an indefinite "check
   * again" loop, this removes the stored CV outright (removeCv() clears
   * profiles.cv_path and enqueues the blob for deletion — see
   * tg_enqueue_profile_media_deletion, 20260901000002) and sends the
   * member back to the CV screen to pick the right file. We only ever
   * store one CV per member, so freeing that slot is required before a
   * fresh upload can take its place.
   */
  const rejectCv = async () => {
    if (rejectingCv) return;
    setRejectingCv(true);
    const removed = await removeCv();
    setRejectingCv(false);
    if (!removed.ok) {
      setError(removed.error);
      return;
    }
    setSuggestionsGaveUp(false);
    setSuggestionsLoading(false);
    patch({
      cvFile: null,
      cvUploadedKey: null,
      cvOriginalFilename: null,
      suggestedSkillIds: [],
    });
    go("cv", "back");
    setError("That didn't look like a CV we could read — please upload a different document.");
  };

  const finish = async () => {
    setBusy(true);
    setError("");
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
    setBusy(false);
    if (rpcError) { setError(describeSupabaseError(rpcError)); bounceIfSessionExpired(rpcError); return; }
    clearDraft();
    track("intake_completed");
    setDone(true);
  };

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
    if (skipWarned.has(id)) return false;
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
    if (consentWarned) return false;
    const hasCv = !!s.cvFile || !!s.cvUploadedKey;
    return hasCv && !s.cvConsent;
  };

  const next = async () => {
    const validationError = validate(step);
    if (validationError) { setError(validationError); return; }

    if (shouldWarnAboutConsent(step)) {
      setConsentWarned(true);
      setConsentWarningFor(step);
      return;
    }

    if (shouldWarnAboutSkipping(step)) {
      setSkipWarned((prev) => new Set(prev).add(step));
      setSkipWarningFor(step);
      return;
    }

    await advance();
  };

  const advance = async () => {
    if (step === "cv") {
      setBusy(true);
      const uploadError = await uploadCv();
      if (uploadError) { setBusy(false); setError(uploadError); return; }
      const linkedinError = await saveLinkedin();
      setBusy(false);
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
    const { error: rpcError } = await supabase.rpc("defer_intake");
    setBusy(false);
    // defer_intake itself enforces compulsoryDone server-side (see
    // 20260901000013) — this error path is the real backstop, not just
    // defensive styling, in case the button was ever shown when it
    // shouldn't have been.
    if (rpcError) { setError(describeSupabaseError(rpcError)); bounceIfSessionExpired(rpcError); return; }
    clearDraft();
    router.push("/home");
  };

  const pct = useMemo(() => completeness(step), [step]);

  const screenProps: ScreenProps = {
    s, patch, firstName, skillTaxonomy, sectors,
    avatarUploading, avatarError, onCropAvatar, existingCv,
    role, existingLinkedin, suggestionsLoading, suggestionsGaveUp, rejectingCv, onRejectCv: rejectCv,
    existingGithubUrl, ingestionEnabled,
    github: {
      connected: ghConnected,
      scanning: ghScanning,
      connecting: ghConnecting,
      error: ghError,
      showcase: ghShowcase,
      saving: ghSaving,
      saved: ghSaved,
      onConnect: connectGithub,
      onSave: saveGithubPicks,
    },
  };

  const body = (() => {
    switch (step) {
      case "face":
        return <FaceScreen {...screenProps} />;
      case "youre-in":
        return <YoureInScreen {...screenProps} matches={matches} />;
      case "cv":
        return <CvScreen {...screenProps} />;
      case "github":
        return <GithubScreen {...screenProps} />;
      case "skills":
        return <SkillsScreen {...screenProps} />;
      case "interests":
        return <InterestsScreen {...screenProps} />;
      case "where":
        return <WhereScreen {...screenProps} />;
      case "want":
        return <WantScreen {...screenProps} />;
    }
  })();

  return (
    <div className="flex min-h-screen flex-col bg-bg-primary">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-bg-primary/90 px-8 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">
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
        className="mx-auto w-full max-w-[1200px] flex-1 px-8 py-12"
      >
        {done ? (
          <div className="mx-auto max-w-[46ch] text-center">
            <span aria-hidden className="mx-auto mb-6 block h-3 w-3 rotate-45 rounded-[1px] bg-signal" />
            <h1 className="mb-4 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-tight text-text-primary">
              All set.
            </h1>
            <p className="mb-8 text-[0.95rem] leading-[1.65] text-text-secondary">
              You can change any of this any time from My Profile.
            </p>
            <Button type="button" variant="primary" size="md" onClick={() => router.push("/home")}>
              Go to your dashboard →
            </Button>
          </div>
        ) : (
          <div className="grid gap-12 lg:grid-cols-[15rem_1fr]">
            <aside className="hidden lg:block">
              <StepRail current={step} onJump={(to) => go(to, "back")} />
            </aside>

            <div className="min-w-0">
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
                <span className="shrink-0 font-mono text-[0.7rem] text-text-muted">
                  {pct}% profile complete
                </span>
              </div>

              <div key={step} className={dir === "fwd" ? "anim-step-fwd" : "anim-step-back"}>
                <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.14em] text-text-muted">
                  {meta.eyebrow}
                </p>
                {step !== "youre-in" && (
                  <h1 className="mb-5 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-tight text-text-primary">
                    {/* STEPS.cv.title is static and reads "if you have one" —
                        wrong for a student, for whom the paragraph right
                        below it says the opposite. Only this one screen's
                        heading needs to be role-aware; everything else can
                        keep reading straight from steps.ts. */}
                    {step === "cv" ? (role === "student" ? "Your CV" : "Your CV, if you have one") : meta.title}
                  </h1>
                )}

                {error && (
                  <div className="mb-6">
                    <ErrorBanner>{error}</ErrorBanner>
                  </div>
                )}

                <div className="rounded-2xl border border-border bg-bg-card p-6 sm:p-8">{body}</div>

                {skipWarningFor && (
                  <SkipWarningDialog
                    onAddNow={() => setSkipWarningFor(null)}
                    onSkip={() => { setSkipWarningFor(null); void advance(); }}
                  />
                )}

                {consentWarningFor && (
                  <ConsentWarningDialog
                    onTickNow={() => setConsentWarningFor(null)}
                    onContinueAnyway={() => { setConsentWarningFor(null); void advance(); }}
                  />
                )}
              </div>

              <div className="mt-8 flex items-center gap-3 border-t border-border-subtle pt-6">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={back}
                  disabled={idx === 0 || busy}
                  className={idx === 0 ? "invisible" : ""}
                >
                  ← Back
                </Button>

                <span className="flex-1" />

                <Button type="button" variant="primary" size="md" onClick={next} loading={busy}>
                  {isLast ? "Finish →" : "Continue →"}
                </Button>
              </div>

              <div className="mt-10 lg:hidden">
                <p className="mb-3 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-text-muted">
                  {GROUPS.length} groups · {TOTAL_SCREENS} screens
                </p>
                <StepRail current={step} onJump={(to) => go(to, "back")} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
