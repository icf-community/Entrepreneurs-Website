"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, closeDialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorBanner } from "@/components/forms/Banners";
import { RepoPicker } from "@/components/github/RepoPicker";
import type { GithubShowcase } from "@/lib/github/showcase";
import {
  getMyGithubShowcase,
  getMyGithubStatus,
  setMyGithubShowcase,
  type GithubScanStatus,
} from "./mediaActions";

// ════════════════════════════════════════════════════════════════════
// Foundry · GitHub dialog
//
// Opens right after the OAuth connect flow redirects back with
// ?github=connected, and again whenever the member wants to change which
// projects they spotlight.
//
// One dialog, four phases — deliberately not two dialogs. The picker
// appears in the SAME surface that showed the scan skeleton, so
// connecting and choosing read as one continuous action rather than a
// success message followed, confusingly, by a second unrequested task:
//
//   scanning → picking → saved
//                     ↘ failed
//
// The polling half is unchanged from the dialog this replaces: the same
// visibility-gated 2s interval CvProcessingDialog.tsx uses, stopping at a
// terminal state.
// ════════════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS = 2000;

type Phase = "scanning" | "picking" | "saved" | "failed" | "loadFailed";



export function GithubDialog({
  onClose,
  onSaved,
  /** Skip the scan poll — the caller already knows the scan is done and
   *  is reopening the dialog purely to change picks. */
  startAtPicker = false,
}: {
  onClose: () => void;
  onSaved?: () => void;
  startAtPicker?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(startAtPicker ? "picking" : "scanning");
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [showcase, setShowcase] = useState<GithubShowcase | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadShowcase = useCallback(async () => {
    const result = await getMyGithubShowcase();
    if (!result.ok || !result.data) {
      setPhase("loadFailed");
      return;
    }
    setShowcase(result.data);
    setPhase("picking");
  }, []);

  useEffect(() => {
    if (startAtPicker) {
      // loadShowcase awaits a server action before it touches any state,
      // so nothing is actually set synchronously here — the rule traces
      // into the callback without seeing the await.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadShowcase();
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const poll = async () => {
      const result = await getMyGithubStatus();
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setPhase("loadFailed");
        stopPolling();
        return;
      }

      const status: GithubScanStatus = result.data.scanStatus;
      setFailureReason(result.data.scanFailureReason);

      if (status === "failed") {
        setPhase("failed");
        stopPolling();
        return;
      }
      if (status === "ready") {
        stopPolling();
        // The scan is what produces available_repos, so the picker can
        // only be loaded once it reaches 'ready'.
        await loadShowcase();
      }
    };

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(poll, POLL_INTERVAL_MS);
    };

    void poll();
    if (document.visibilityState === "visible") startPolling();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void poll();
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [startAtPicker, loadShowcase]);

  async function save(picks: { name: string; blurb: string }[]) {
    setSaving(true);
    setSaveError(null);
    const result = await setMyGithubShowcase(picks);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setPhase("saved");
    onSaved?.();
  }

  // "saved" used to be a dead end — a static line with only the X to
  // leave, so a member who'd just finished picking was stuck reading it
  // until they noticed the close button. The regeneration itself is
  // fire-and-forget (refresh_github_summary runs in the background, not
  // polled here), so there's nothing to wait ON — closing on a timer
  // reads as "done", not as abandoning an in-progress task.
  useEffect(() => {
    if (phase !== "saved") return;
    const timeout = setTimeout(onClose, 2200);
    return () => clearTimeout(timeout);
  }, [phase, onClose]);

  return (
    <Dialog
      onClose={onClose}
      label="Your GitHub projects"
      className="w-full max-w-[560px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto p-7"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[1.2rem] text-text-primary">Your GitHub</h2>
        <button
          type="button"
          onClick={closeDialog}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 text-text-muted transition-colors hover:bg-white/[0.06]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {phase === "loadFailed" && (
        <p className="text-[0.85rem] text-text-muted">
          We couldn&apos;t load your repositories just now. Your GitHub is connected — check back on
          this page in a moment.
        </p>
      )}

      {phase === "scanning" && (
        <div className="space-y-3">
          <p className="text-[0.85rem] text-text-secondary">Reading your public repositories…</p>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {phase === "failed" && (
        <p className="text-[0.85rem] text-text-secondary">
          {failureReason ?? "We couldn't scan your GitHub repositories. You may need to reconnect."}
        </p>
      )}

      {phase === "picking" && showcase && (
        <>
          {saveError && <div className="mb-3"><ErrorBanner>{saveError}</ErrorBanner></div>}
          <RepoPicker
            availableRepos={showcase.availableRepos}
            showcaseRepos={showcase.showcaseRepos}
            suggestedRepos={showcase.suggestedRepos}
            seenRepos={showcase.seenRepos}
            saving={saving}
            onSave={save}
            onSkip={onClose}
            skipLabel="Not now"
          />
        </>
      )}

      {phase === "saved" && (
        <div className="space-y-3">
          <p className="text-[0.85rem] text-text-secondary">
            Saved. These are what recruiters will see — updating your profile summary to match.
          </p>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      )}
    </Dialog>
  );
}
