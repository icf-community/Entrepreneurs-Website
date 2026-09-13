"use client";

import { useEffect, useState } from "react";
import { Dialog, closeDialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { getMyCvProfile, getMyCvStatus, type CvIngestStatus } from "./mediaActions";

// ════════════════════════════════════════════════════════════════════
// Foundry · CV processing dialog
//
// Opens right after a CV upload confirms. The ingest worker
// (server/app/worker.py) processes it asynchronously — cv-matchmaker-
// spec.md's pipeline runs moderation, extraction, skill normalisation,
// and chunk+embed in a separate process — so this polls get_my_cv_status
// until it reaches a terminal state, the same visibility-gated interval
// pattern CommunityClient.tsx uses for its own polling, then shows the
// generated summary and matched skills via get_my_cv_profile once ready.
//
// GATED ON THE SAME parse-consent checkbox as the older, separate
// skill-prefill flow (prefillCvSkillsInBackground) — confirm_cv_upload
// (20260906000001) only opens a cvs row, and so only enqueues anything
// for this pipeline to process, when that box is ticked. This dialog
// is only ever opened when it was (ProfileForm.tsx / IntakeFlow.tsx
// both check consent first), so it never has to account for the
// unconsented case itself — but don't assume "every CV upload feeds
// this pipeline" from reading this file in isolation; it doesn't.
// ════════════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS = 2000;

const PROCESSING_STATUSES: CvIngestStatus[] = ["pending", "extracting", "embedding"];

export function CvProcessingDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<CvIngestStatus | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ summary: string; skills: string[] } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const poll = async () => {
      const result = await getMyCvStatus();
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setLoadFailed(true);
        stopPolling();
        return;
      }

      setStatus(result.data.status);
      setFailureReason(result.data.failureReason);

      if (result.data.status === "ready") {
        stopPolling();
        const profileResult = await getMyCvProfile();
        if (cancelled) return;
        if (profileResult.ok && profileResult.data) {
          setProfile(profileResult.data);
        } else {
          setLoadFailed(true);
        }
      } else if (result.data.status === "failed" || result.data.status === "flagged") {
        stopPolling();
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
  }, []);

  const processing = status === null || PROCESSING_STATUSES.includes(status);

  return (
    <Dialog
      onClose={onClose}
      label="CV processing"
      className="w-full max-w-[520px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto p-7"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[1.2rem] text-text-primary">Your CV</h2>
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

      {loadFailed && (
        <p className="text-[0.85rem] text-text-muted">
          We couldn&apos;t check your CV&apos;s status just now. It&apos;s already saved — check back on this page in a
          moment.
        </p>
      )}

      {!loadFailed && processing && (
        <div className="space-y-3">
          <p className="text-[0.85rem] text-text-secondary">Reading your CV and generating a summary…</p>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {!loadFailed && status === "failed" && (
        <p className="text-[0.85rem] text-text-secondary">
          {failureReason ?? "That file couldn't be processed. Please upload a text-based PDF or Word document."}
        </p>
      )}

      {!loadFailed && status === "flagged" && (
        <p className="text-[0.85rem] text-text-secondary">
          Your CV needs a quick manual check before it&apos;s used in search. This doesn&apos;t affect the rest of
          your account.
        </p>
      )}

      {!loadFailed && status === "ready" && profile && (
        <div className="space-y-4">
          {profile.skills.length > 0 && (
            <section>
              <div className="mb-2 text-[0.7rem] uppercase tracking-wider text-text-muted">Skills detected</div>
              <div className="flex flex-wrap gap-1.5">
                {profile.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-lg border border-border bg-white/[0.03] px-2.5 py-1 text-[0.725rem] text-text-secondary"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
