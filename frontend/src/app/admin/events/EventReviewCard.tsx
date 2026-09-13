"use client";

import { useState, useTransition } from "react";
import { approveEvent, rejectEvent } from "./actions";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";
import { externalHref } from "@/lib/safeUrl";

type Ev = {
  id: string;
  title: string;
  description: string;
  lumaLink: string;
  eventAt: string;
  location: string;
  organiserName: string;
  contactEmail: string;
  contactEmailVisible: boolean;
  postedBy: {
    firstName: string;
    surname: string;
    linkedinUrl: string | null;
    signupEmail: string | null;
  };
  createdAt: string;
};

export default function EventReviewCard({ ev }: { ev: Ev }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const submittedOn = formatDate(ev.createdAt);
  const when = formatDateTime(ev.eventAt);

  const handleApprove = () => {
    setError("");
    startTransition(async () => {
      const res = await approveEvent(ev.id);
      if (!res.ok) setError(res.error);
    });
  };

  const handleReject = () => {
    setError("");
    startTransition(async () => {
      const res = await rejectEvent(ev.id, reason);
      if (!res.ok) setError(res.error);
      else { setShowReject(false); setReason(""); }
    });
  };

  return (
    <article className="rounded-2xl bg-bg-card border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-6 py-5 text-left bg-transparent border-0 cursor-pointer transition-colors duration-150 hover:bg-white/[0.02]"
      >
        <div>
          <div className="text-[1.05rem] font-medium text-text-primary">{ev.title}</div>
          <div className="text-[0.8rem] text-text-muted mt-1">
            {when} · {ev.location} · Organised by {ev.organiserName}
          </div>
          <div className="text-[0.75rem] text-text-muted mt-1">
            Posted by <span className="text-text-secondary">{ev.postedBy.firstName} {ev.postedBy.surname}</span>
            {ev.postedBy.signupEmail && (<> · <span className="text-text-secondary">{ev.postedBy.signupEmail}</span></>)}
            {" · submitted "}{submittedOn}
          </div>
        </div>
        <div className="text-[0.7rem] text-text-muted mt-3">
          {open ? "▾ Hide details" : "▸ Show details"}
        </div>
      </button>

      {open && (
        <div className="px-6 pb-6 pt-1 border-t border-border-subtle space-y-5">
          <DetailBlock label="Description">
            <p className="text-[0.85rem] text-text-secondary leading-relaxed whitespace-pre-wrap">{ev.description}</p>
          </DetailBlock>
          <DetailBlock label="Luma link">
            <a href={externalHref(ev.lumaLink)} target="_blank" rel="noreferrer noopener" className="text-[0.85rem] text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent">
              {ev.lumaLink} ↗
            </a>
          </DetailBlock>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailBlock label="Poster (signup email)">
              <p className="text-[0.85rem] text-text-secondary">{ev.postedBy.signupEmail ?? "—"}</p>
              {ev.postedBy.linkedinUrl && (
                <a href={externalHref(ev.postedBy.linkedinUrl)} target="_blank" rel="noreferrer noopener" className="text-[0.75rem] text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent">LinkedIn ↗</a>
              )}
            </DetailBlock>
            <DetailBlock label="Public contact email">
              <p className="text-[0.85rem] text-text-secondary">
                {ev.contactEmail}
                <span className="text-text-muted ml-2 text-[0.75rem]">
                  ({ev.contactEmailVisible ? "visible to members" : "hidden"})
                </span>
              </p>
            </DetailBlock>
          </div>
        </div>
      )}

      {error && <div className="mx-6 mb-3"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="px-6 pb-6">
        {showReject ? (
          <div className="space-y-3 pt-3 border-t border-border-subtle">
            <label htmlFor={`reason-${ev.id}`} className="block text-[0.75rem] text-text-muted">
              Reason for rejection (internal)
            </label>
            <textarea
              id={`reason-${ev.id}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.03] border border-border rounded-lg text-[0.8rem] text-text-primary placeholder:text-text-muted focus:border-accent/50 resize-none"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleReject}
                disabled={pending || !reason.trim()}
                variant="danger"
                size="sm"
              >
                {pending ? "Rejecting…" : "Confirm rejection"}
              </Button>
              <Button
                type="button"
                onClick={() => { setShowReject(false); setReason(""); setError(""); }}
                disabled={pending}
                variant="ghost"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-3 border-t border-border-subtle">
            <Button
              type="button"
              onClick={handleApprove}
              disabled={pending}
              variant="primary"
              size="sm"
            >
              {pending ? "Approving…" : "Approve"}
            </Button>
            <Button
              type="button"
              onClick={() => setShowReject(true)}
              disabled={pending}
              variant="dangerGhost"
              size="sm"
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  );
}
