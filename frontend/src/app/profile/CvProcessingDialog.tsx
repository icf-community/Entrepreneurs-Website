"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogClose } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { watchProgress } from "@/lib/realtime/progress";
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

// Pace of the fallback poll, used only if the Realtime channel can't join.
const POLL_INTERVAL_MS = 2000;

const PROCESSING_STATUSES: CvIngestStatus[] = ["pending", "extracting", "embedding"];

export function CvProcessingDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<CvIngestStatus | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ summary: string; skills: string[] } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Bumped by "Try again" to restart the poll after a failure.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Re-reads when the CV row changes (lib/realtime/progress), with the old
    // backoff poll only as a fallback. A thrown request ends in the failure
    // state (with Try again) instead of a spinner that never stops.
    const stop = watchProgress({
      kind: "cv",
      fetch: async () => {
        const result = await getMyCvStatus();
        if (!result.ok || !result.data) throw new Error("status unavailable");
        return result.data;
      },
      onResult: (data) => {
        setStatus(data.status);
        setFailureReason(data.failureReason);
        if (data.status === "ready") {
          getMyCvProfile().then(
            (profileResult) => {
              if (cancelled) return;
              if (profileResult.ok && profileResult.data) setProfile(profileResult.data);
              else setLoadFailed(true);
            },
            () => { if (!cancelled) setLoadFailed(true); },
          );
          return "stop";
        }
        return PROCESSING_STATUSES.includes(data.status) ? "continue" : "stop";
      },
      onError: () => { if (!cancelled) setLoadFailed(true); },
      baseMs: POLL_INTERVAL_MS,
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [attempt]);

  const processing = status === null || PROCESSING_STATUSES.includes(status);

  return (
    <Dialog onClose={onClose} label="CV processing" className="my-auto w-full max-w-[520px] p-7">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="font-display text-title text-text-primary">Your CV</h2>
        <DialogClose className="-mr-2" />
      </div>

      {loadFailed && (
        <Notice
          tone="danger"
          role="alert"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setLoadFailed(false); setStatus(null); setAttempt((n) => n + 1); }}
            >
              Try again
            </Button>
          }
        >
          We couldn&apos;t check your CV&apos;s status just now. It&apos;s already saved.
        </Notice>
      )}

      {!loadFailed && processing && (
        <div className="space-y-3">
          <p className="text-body text-text-secondary">Reading your CV and generating a summary…</p>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {!loadFailed && status === "failed" && (
        <p className="text-body text-text-secondary">
          {failureReason ?? "That file couldn't be processed. Please upload a text-based PDF or Word document."}
        </p>
      )}

      {!loadFailed && status === "flagged" && (
        <p className="text-body text-text-secondary">
          Your CV needs a quick manual check before it&apos;s used in search. This doesn&apos;t affect the rest of
          your account.
        </p>
      )}

      {!loadFailed && status === "ready" && profile && (
        <div className="space-y-4">
          {profile.skills.length > 0 && (
            <section>
              <div className="mb-2 text-small text-text-muted">Skills detected</div>
              <div className="flex flex-wrap gap-2">
                {profile.skills.map((skill) => (
                  <Badge key={skill}>{skill}</Badge>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
