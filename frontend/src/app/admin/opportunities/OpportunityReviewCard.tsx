"use client";

import { useState, useTransition } from "react";
import { approveOpportunity, rejectOpportunity } from "./actions";
import { formatDate } from "@/lib/dates";
import { ApprovalActions, RejectionForm } from "@/components/admin/ReviewActions";
import { ErrorBanner } from "@/components/forms/Banners";
import { externalHref } from "@/lib/safeUrl";
import { PosterContactDetails } from "@/components/admin/PosterContactDetails";

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

function formatLocation(o: Opportunity): string {
  if (o.locationType === "remote") return "Remote";
  if (o.locationType === "hybrid") return `Hybrid${o.locationText ? ` · ${o.locationText}` : ""}`;
  return o.locationText || "Onsite";
}

export default function OpportunityReviewCard({ opportunity: o }: { opportunity: Opportunity }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const submittedOn = formatDate(o.createdAt);
  const start = `${MONTHS[o.startMonth - 1]} ${o.startYear}`;
  const deadline = formatDate(o.applicationDeadline);
  const location = formatLocation(o);

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

      {open && <OpportunityDetails o={o} location={location} start={start} deadline={deadline} />}

      {error && <div className="mx-6 mb-3"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="px-6 pb-6">
        {showReject ? (
          <RejectionForm
            id={`reason-${o.id}`}
            reason={reason}
            onReasonChange={setReason}
            placeholder="e.g. Pay missing / duplicate / unclear company"
            label="Reason for rejection (internal — not currently emailed to the poster)"
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

function OpportunityDetails({ o, location, start, deadline }: {
  o: Opportunity;
  location: string;
  start: string;
  deadline: string;
}) {
  return (
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

      <PosterContactDetails
        postedBy={o.postedBy}
        contactEmail={o.contactEmail}
        contactEmailVisible={o.contactEmailVisible}
      />

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
