"use client";

import { useState, useTransition } from "react";
import { approveVcGrant, rejectVcGrant } from "./actions";
import { track } from "@/lib/analytics/track";
import { formatDate } from "@/lib/dates";
import { ErrorBanner } from "@/components/forms/Banners";
import { ApprovalActions, RejectionForm } from "@/components/admin/ReviewActions";
import { externalHref } from "@/lib/safeUrl";

type Vc = {
  id: string;
  kind: "vc" | "grant";
  name: string;
  description: string;
  link: string;
  amount: string | null;
  deadline: string | null;
  stage: string | null;
  postedBy: {
    firstName: string;
    surname: string;
    linkedinUrl: string | null;
    signupEmail: string | null;
  };
  createdAt: string;
  editVersion: number;
};

export default function VcReviewCard({ vc: v }: { vc: Vc }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const submittedOn = formatDate(v.createdAt);
  const deadline = v.deadline ? formatDate(v.deadline) : null;

  const handleApprove = () => {
    setError("");
    startTransition(async () => {
      const res = await approveVcGrant(v.id, v.editVersion);
      if (!res.ok) setError(res.error);
      else track("admin_listing_approved", { kind: "vc_grant", id: v.id });
    });
  };

  const handleReject = () => {
    setError("");
    startTransition(async () => {
      const res = await rejectVcGrant(v.id, reason);
      if (!res.ok) setError(res.error);
      else { track("admin_listing_rejected", { kind: "vc_grant", id: v.id }); setShowReject(false); setReason(""); }
    });
  };

  return (
    <article className="rounded-2xl bg-bg-card border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-6 py-5 text-left bg-transparent border-0 cursor-pointer transition-colors duration-150 hover:bg-tint-1"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lead font-medium text-text-primary">{v.name}</div>
            <div className="text-body text-text-muted mt-1">
              {v.stage  && <>{v.stage} · </>}
              {v.amount && <>{v.amount} · </>}
              {deadline ? `Deadline ${deadline}` : "No deadline"}
            </div>
            <div className="text-small text-text-muted mt-1">
              Posted by <span className="text-text-secondary">{v.postedBy.firstName} {v.postedBy.surname}</span>
              {v.postedBy.signupEmail && (<> · <span className="text-text-secondary">{v.postedBy.signupEmail}</span></>)}
              {" · submitted "}{submittedOn}
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-lg text-caption bg-accent-muted text-accent-light border border-accent/20 shrink-0">
            {v.kind === "vc" ? "VC" : "Grant"}
          </span>
        </div>
        <div className="text-small text-text-muted mt-3">
          {open ? "▾ Hide details" : "▸ Show details"}
        </div>
      </button>

      {open && <VcDetails v={v} />}

      {error && <div className="mx-6 mb-3"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="px-6 pb-6">
        {showReject ? (
          <RejectionForm
            id={`reason-${v.id}`}
            reason={reason}
            onReasonChange={setReason}
            label="Reason for rejection (internal)"
            confirmLabel="Confirm rejection"
            pending={pending}
            onConfirm={handleReject}
            onCancel={() => { setShowReject(false); setReason(""); setError(""); }}
          />
        ) : (
          <ApprovalActions pending={pending} onApprove={handleApprove} onReject={() => setShowReject(true)} />
        )}
      </div>
    </article>
  );
}

function VcDetails({ v }: { v: Vc }) {
  return (
    <div className="px-6 pb-6 pt-1 border-t border-border-subtle space-y-5">
      <DetailBlock label="Description">
        <p className="text-body text-text-secondary leading-relaxed whitespace-pre-wrap">{v.description}</p>
      </DetailBlock>
      <DetailBlock label="Link">
        <a href={externalHref(v.link)} target="_blank" rel="noreferrer noopener" className="text-body text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent">
          {v.link} ↗
        </a>
      </DetailBlock>
      <DetailBlock label="Poster (signup email)">
        <p className="text-body text-text-secondary">{v.postedBy.signupEmail ?? "—"}</p>
        {v.postedBy.linkedinUrl && (
          <a href={externalHref(v.postedBy.linkedinUrl)} target="_blank" rel="noreferrer noopener" className="text-small text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent">LinkedIn ↗</a>
        )}
      </DetailBlock>
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-small text-text-muted mb-1">{label}</div>
      {children}
    </div>
  );
}
