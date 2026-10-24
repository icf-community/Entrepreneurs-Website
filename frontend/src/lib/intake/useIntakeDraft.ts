"use client";

import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { IntakeState } from "./state";

// ════════════════════════════════════════════════════════════════════
// Foundry · Intake answer drafts, in localStorage
//
// Per-viewer convenience, same precedent as components/app/Sidebar.tsx's
// collapsed-nav flag — not shared state, so it has no business in the
// Upstash cache (see lib/cache.ts's own header: that layer is only for
// responses identical for every member).
//
// photoBlob/photoPreview/cvFile are excluded: they aren't JSON-safe (a
// File/Blob or an object URL that dies with the tab that made it), and
// they're already covered a different way — confirm_avatar_upload and
// confirm_cv_upload persist to the DB the moment an upload finishes, and
// IntakeFlow re-hydrates "already uploaded" from the server on mount.
// Persisting them here would either throw or show a stale, broken image.
//
// suggestedSkillIds is excluded for the same reason: confirmCvUpload's
// background extraction persists it to cv_suggested_skill_ids, and
// IntakeFlow's own effect re-fetches it from there on arriving at the
// Skills screen. A stale array surviving in this draft — say, from a CV
// that has since been replaced — would otherwise block that re-fetch
// (it only runs while the in-memory value is still empty) and show
// suggestions for a CV that's no longer the one on file.
// ════════════════════════════════════════════════════════════════════

const TRANSIENT_KEYS = new Set<keyof IntakeState>([
  "photoBlob", "photoPreview", "cvFile", "suggestedSkillIds",
]);

type Draft = Partial<IntakeState>;

function draftKey(memberId: string): string {
  return `foundry:intake:draft:${memberId}`;
}

function serialisable(s: IntakeState): Draft {
  const out: Draft = {};
  for (const k of Object.keys(s) as (keyof IntakeState)[]) {
    if (!TRANSIENT_KEYS.has(k)) (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

/** Reads and applies any saved draft once on mount, then persists every
 *  change (debounced). Returns a function to clear the draft on completion. */
export function useIntakeDraft(
  memberId: string,
  s: IntakeState,
  setS: Dispatch<SetStateAction<IntakeState>>,
): () => void {
  const ready = useRef(false);

  // Hydrate once. A ref (not state) tracks readiness so the very first
  // render — before any draft has been applied — never gets persisted
  // back over itself.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(memberId));
      // react-doctor-disable-next-line no-pass-data-to-parent -- one-time localStorage hydration (gated by a ready ref); can't be read synchronously during render without an SSR/hydration mismatch
      if (raw) setS((prev) => ({ ...prev, ...(JSON.parse(raw) as Draft) }));
    } catch {
      // Corrupt or inaccessible storage — start from the server-seeded state.
    }
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(memberId), JSON.stringify(serialisable(s)));
      } catch {
        // Storage full or unavailable — the draft just doesn't survive a reload.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [memberId, s]);

  return () => {
    try {
      localStorage.removeItem(draftKey(memberId));
    } catch {
      // Nothing to do if storage is unavailable.
    }
  };
}
