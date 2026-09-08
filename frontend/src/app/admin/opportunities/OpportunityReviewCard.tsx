"use client";

import { useState, useTransition } from "react";
import { approveOpportunity, rejectOpportunity } from "./actions";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";
import { externalHref } from "@/lib/safeUrl";

type Opportunity = {
  id: string;
  positionName: string;
  company: string;
  pay: string;
  locationType: "remote" | "hybrid" | "onsite";
  locationText: string | null;
  description: string;
  startMonth: number;
  startYear: number;
  applicationDeadline: string;
  contactEmail: string;
  contactEmailVisible: boolean;
  applyMethod: "email" | "link";
  applyUrl: string | null;
  postedBy: {
    firstName: string;
    surname: string;
    linkedinUrl: string | null;
    signupEmail: string | null;
  };
  skills: string[];
  sectors: string[];
  createdAt: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function OpportunityReviewCard({ opportunity: o }: { opportunity: Opportunity }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const submittedOn = formatDate(o.createdAt);
  const start = `${MONTHS[o.startMonth - 1]} ${o.startYear}`;
  const deadline = formatDate(o.applicationDeadline);
  const location =
    o.locationType === "remote" ? "Remote"
    : o.locationType === "hybrid" ? `Hybrid${o.locationText ? ` · ${o.locationText}` : ""}`
    : o.locationText || "Onsite";

  const handleApprove = () => {
    setError("");
    startTransition(async () => {
      const res = await approveOpportunity(o.id);
      if (!res.ok) setError(res.error);
    });
  };

  const handleReject = () => {
    setError("");
    startTransition(async () => {
      const res = await rejectOpportunity(o.id, reason);
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
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[1.05rem] font-medium text-text-primary">{o.positionName}</div>
            <div className="text-[0.8rem] text-text-muted mt-1">
              {o.company} · {location} · Starts {start} · Apply by {deadline}
            </div>
            <div className="text-[0.75rem] text-text-muted mt-1">
              Posted by <span className="text-text-secondary">{o.postedBy.firstName} {o.postedBy.surname}</span>
              {o.postedBy.signupEmail && (
                <> · <span className="text-text-secondary">{o.postedBy.signupEmail}</span></>
              )}
              {" · submitted "}{submittedOn}
            </div>
          </div>
          <div className="text-[0.75rem] text-accent-light shrink-0">{o.pay}</div>
        </div>
        <div className="text-[0.7rem] text-text-muted mt-3">
          {open ? "▾ Hide full details" : "▸ Show full details"}
        </div>
      </button>

      {open && (
        <div className="px-6 pb-6 pt-1 border-t border-border-subtle space-y-5">
          <DetailBlock label="Description">
            <p className="text-[0.85rem] text-text-secondary leading-relaxed whitespace-pre-wrap">{o.description}</p>
          </DetailBlock>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailBlock label="Compensation">
              <p className="text-[0.85rem] text-text-secondary">{o.pay}</p>
            </DetailBlock>
            <DetailBlock label="Location">
              <p className="text-[0.85rem] text-text-secondary">{location}</p>
            </DetailBlock>
            <DetailBlock label="Start date">
              <p className="text-[0.85rem] text-text-secondary">{start}</p>
            </DetailBlock>
            <DetailBlock label="Application deadline">
              <p className="text-[0.85rem] text-text-secondary">{deadline}</p>
            </DetailBlock>
          </div>

          <DetailBlock label="How to apply">
            {o.applyMethod === "link" ? (
              <a href={externalHref(o.applyUrl)} target="_blank" rel="noreferrer noopener" className="text-[0.85rem] text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent">
                {o.applyUrl} ↗
              </a>
            ) : (
              <p className="text-[0.85rem] text-text-secondary">Via contact email below.</p>
            )}
          </DetailBlock>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailBlock label="Poster (signup email)">
              <p className="text-[0.85rem] text-text-secondary">{o.postedBy.signupEmail ?? "—"}</p>
              {o.postedBy.linkedinUrl && (
                <a href={externalHref(o.postedBy.linkedinUrl)} target="_blank" rel="noreferrer noopener" className="text-[0.75rem] text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent">LinkedIn ↗</a>
              )}
            </DetailBlock>
            <DetailBlock label="Public contact email">
              <p className="text-[0.85rem] text-text-secondary">
                {o.contactEmail}
                <span className="text-text-muted ml-2 text-[0.75rem]">
                  ({o.contactEmailVisible ? "visible to members" : "hidden"})
                </span>
              </p>
            </DetailBlock>
          </div>

          {(o.sectors.length > 0 || o.skills.length > 0) && (
            <DetailBlock label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {o.sectors.map((s) => (
                  <span key={`sec-${s}`} className="px-2 py-0.5 rounded-lg text-[0.7rem] bg-accent-muted text-accent-light border border-accent/20">{s}</span>
                ))}
                {o.skills.map((s) => (
                  <span key={`skl-${s}`} className="px-2 py-0.5 rounded-lg text-[0.7rem] bg-white/[0.03] text-text-secondary border border-border">{s}</span>
                ))}
              </div>
            </DetailBlock>
          )}
        </div>
      )}

      {error && <div className="mx-6 mb-3"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="px-6 pb-6">
        {showReject ? (
          <div className="space-y-3 pt-3 border-t border-border-subtle">
            <label htmlFor={`reason-${o.id}`} className="block text-[0.75rem] text-text-muted">
              Reason for rejection (internal — not currently emailed to the poster)
            </label>
            <textarea
              id={`reason-${o.id}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Pay missing / duplicate / unclear company"
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
