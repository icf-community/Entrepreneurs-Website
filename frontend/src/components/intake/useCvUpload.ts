import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { requestCvTicket, confirmCvUpload, removeCv } from "@/app/profile/mediaActions";
import { track } from "@/lib/analytics/track";
import { watchProgress } from "@/lib/realtime/progress";
import type { StepId } from "@/lib/intake/steps";
import type { IntakeState } from "@/lib/intake/state";

type Patch = (p: Partial<IntakeState>) => void;

/**
 * CV upload, the wait for background suggestions, and the "that wasn't a CV
 * we could read" reject flow — extracted out of IntakeFlow (structural
 * only, no behavior change) to keep that component's size and
 * complexity down.
 */
export function useCvUpload(
  supabase: ReturnType<typeof createClient>,
  step: StepId,
  s: IntakeState,
  patch: Patch,
  goBackToCv: () => void,
  setError: (message: string) => void,
) {
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // Set only when the bounded wait below runs out with
  // nothing found. We can't distinguish "slow extraction" from "this
  // wasn't a CV we could read" from here, and the product call is to
  // treat it as the latter: ask for the right document back rather than
  // leave someone polling indefinitely on a maybe-bad upload.
  const [suggestionsGaveUp, setSuggestionsGaveUp] = useState(false);
  // True while rejectCv's removeCv() round trip is in flight — disables
  // the reject button so a slow connection can't fire it twice.
  const [rejectingCv, setRejectingCv] = useState(false);

  /**
   * confirmCvUpload's background extraction usually finishes well before
   * the member reaches this screen, but not always. The suggestions column
   * announces its own change (lib/realtime/progress), so this re-reads
   * only when it moves rather than on a timer. Bounded at ~9 s, the same
   * as the old 6 × 1.5 s poll, so a slow or failed extraction ends in the
   * "that wasn't a CV we could read" flow instead of spinning forever,
   * with a loading state so the screen shows "reading your CV" meanwhile.
   *
   * suggestionsLoading is set to true in next()'s cv-branch, right after
   * a successful upload/save — not synchronously in this effect, which
   * is the react-hooks/set-state-in-effect trap this codebase already
   * hit once (see AvatarCropper's history). This effect only waits and
   * turns it back off; the guard below just means "a wait is needed and
   * hasn't finished yet" — it also naturally resumes if the member
   * leaves "skills" mid-wait and comes back (the effect re-runs on the
   * step change, and suggestionsLoading is still true from before).
   */
  useEffect(() => {
    if (step !== "skills" || !suggestionsLoading) return;
    const MAX_WAIT_MS = 9_000;
    const stop = watchProgress({
      kind: "cv_suggestions",
      fetch: async () => {
        const { data } = await supabase.rpc("get_my_cv_info").maybeSingle();
        return data?.cv_suggested_skill_ids ?? null;
      },
      onResult: (ids) => {
        if (!ids || ids.length === 0) return "continue";
        clearTimeout(deadline);
        patch({ suggestedSkillIds: ids });
        setSuggestionsLoading(false);
        setSuggestionsGaveUp(false);
        return "stop";
      },
      // A thrown read ends the wait; the deadline below still reports it.
      onError: () => {},
      baseMs: 1500,
      maxMs: 1500,
    });
    // Declared after the wait starts; onResult only runs after an await, so
    // it is always initialised by the time anything reads it.
    const deadline = setTimeout(() => {
      stop();
      setSuggestionsLoading(false);
      setSuggestionsGaveUp(true);
    }, MAX_WAIT_MS);

    return () => {
      clearTimeout(deadline);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wait while go() has flagged loading for this arrival at "skills"
  }, [step, suggestionsLoading]);

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
      track("cv_uploaded", { consent: s.cvConsent });

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
      const cvSkillIdSet = new Set(s.cvSkillIds);
      patch({
        cvUploadedKey: stored.key,
        cvOriginalFilename: s.cvFile.name,
        suggestedSkillIds: [],
        skillIds: s.skillIds.filter((id) => !cvSkillIdSet.has(id)),
        coreSkillIds: s.coreSkillIds.filter((id) => !cvSkillIdSet.has(id)),
        cvSkillIds: [],
      });
      return null;
    } catch {
      // Network error or the timeout above firing — this call previously had
      // no catch at all, so either one was an unhandled rejection.
      return "Couldn't reach the file service. Try again in a moment.";
    }
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
    goBackToCv();
    setError("That didn't look like a CV we could read — please upload a different document.");
  };

  return {
    suggestionsLoading,
    setSuggestionsLoading,
    suggestionsGaveUp,
    rejectingCv,
    uploadCv,
    rejectCv,
  };
}
