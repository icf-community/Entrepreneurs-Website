import { useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { describeSupabaseError, isSessionExpiredError } from "@/lib/supabaseErrors";

/**
 * LinkedIn-save handling for the CV/LinkedIn screen — extracted out of
 * IntakeFlow (structural only, no behavior change) to keep that
 * component's size and complexity down.
 */
export function useLinkedinSave(
  supabase: ReturnType<typeof createClient>,
  existingLinkedin: string | null,
  bounceIfSessionExpired: (rpcError: Parameters<typeof isSessionExpiredError>[0]) => void,
) {
  // Whether LinkedIn is actually persisted server-side, not just typed
  // into the field — seeded from the server prop, then flipped true by
  // saveLinkedin() below. Deliberately NOT derived from s.linkedin: a
  // localStorage draft can rehydrate typed-but-never-sent text, and
  // that must not unlock Skip on its own (see the user correction this
  // whole gate exists for — 20260901000013's header comment).
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- one-time seed from a server prop that this page-level component only receives once per mount; diverges via its own explicit setter afterward, no external writer
  const [linkedinSaved, setLinkedinSaved] = useState(!!existingLinkedin);

  /**
   * Persists LinkedIn the moment the member continues past the CV
   * screen — not bundled into Finish — so compulsoryDone reflects a
   * real, server-checked fact as soon as it's true. Always calls
   * through rather than diffing against existingLinkedin: the RPC is a
   * cheap single-column write, and this only runs once per Continue.
   */
  const saveLinkedin = async (linkedin: string): Promise<string | null> => {
    const { error: rpcError } = await supabase.rpc("set_my_linkedin", {
      p_linkedin_url: linkedin.trim(),
    });
    if (rpcError) { bounceIfSessionExpired(rpcError); return describeSupabaseError(rpcError); }
    setLinkedinSaved(true);
    return null;
  };

  return { linkedinSaved, saveLinkedin };
}
