"use client";

import { useState, useTransition } from "react";
import { approveOpportunity, rejectOpportunity } from "./actions";
import { track } from "@/lib/analytics/track";
import { formatDate } from "@/lib/dates";
import { ApprovalActions, RejectionForm } from "@/components/admin/ReviewActions";
import { ErrorBanner } from "@/components/forms/Banners";
import { Badge } from "@/components/ui/Badge";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Disclosure } from "@/components/ui/Disclosure";
import { Icon } from "@/design-system/icons/Icon";
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
  editVersion: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatLocation(o: Opportunity): string {
  if (o.locationType === "remote") return "Remote";
  if (o.locationType === "hybrid") return `Hybrid${o.locationText ? ` · ${o.locationText}` : ""}`;
  return o.locationText || "Onsite";
}

export default function OpportunityReviewCard({ opportunity: o }: { opportunity: Opportunity }) {
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
      const res = await approveOpportunity(o.id, o.editVersion);
      if (!res.ok) setError(res.error);
      else track("admin_listing_approved", { kind: "opportunity", id: o.id });
    });
  };

  const handleReject = () => {
    setError("");
    startTransition(async () => {
      const res = await rejectOpportunity(o.id, reason);
      if (!res.ok) setError(res.error);
      else { track("admin_listing_rejected", { kind: "opportunity", id: o.id }); setShowReject(false); setReason(""); }
    });
  };

  return (
    <Disclosure
      as="article"
      size="sm"
      lazy
      closedLabel="Show full details"
      openLabel="Hide full details"
      summary={
        <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <span className="min-w-0">
            <span className="block font-display text-lead text-text-primary">{o.positionName}</span>
            <span className="mt-1 block text-body text-text-secondary">
              {o.company} · {location} · Starts <span className="data">{start}</span> · Apply by <span className="data">{deadline}</span>
            </span>
            <span className="mt-1 block text-small text-text-muted">
              Posted by <span className="text-text-secondary">{o.postedBy.firstName} {o.postedBy.surname}</span>
              {o.postedBy.signupEmail && (
                <> · <span className="text-text-secondary">{o.postedBy.signupEmail}</span></>
              )}
              {" · submitted "}<span className="data">{submittedOn}</span>
            </span>
          </span>
          <span className="shrink-0 text-body text-accent-light">{o.pay}</span>
        </span>
      }
      footer={
        <>
          {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}
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
        </>
      }
    >
      <OpportunityDetails o={o} location={location} start={start} deadline={deadline} />
    </Disclosure>
  );
}

function OpportunityDetails({ o, location, start, deadline }: {
  o: Opportunity;
  location: string;
  start: string;
  deadline: string;
}) {
  return (
    <div className="grid gap-5 pt-4">
      <DefinitionList>
        <Definition term="Description">
          <p className="whitespace-pre-wrap leading-relaxed">{o.description}</p>
        </Definition>
      </DefinitionList>

      <DefinitionList>
        <Definition term="Compensation">{o.pay}</Definition>
        <Definition term="Location">{location}</Definition>
        <Definition term="Start date">{start}</Definition>
        <Definition term="Application deadline">{deadline}</Definition>
      </DefinitionList>

      <DefinitionList>
        <Definition term="How to apply">
          {o.applyMethod === "link" ? (
            <a
              href={externalHref(o.applyUrl)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-text-primary underline underline-offset-4 decoration-border-strong transition-colors hover:decoration-accent"
            >
              {o.applyUrl}
              <span className="sr-only"> ↗</span>
              <Icon name="arrow-up-right" size={16} className="ml-1 inline-block align-text-bottom" />
            </a>
          ) : (
            "Via contact email below."
          )}
        </Definition>
      </DefinitionList>

      <PosterContactDetails
        postedBy={o.postedBy}
        contactEmail={o.contactEmail}
        contactEmailVisible={o.contactEmailVisible}
      />

      {(o.sectors.length > 0 || o.skills.length > 0) && (
        <DefinitionList>
          <Definition term="Tags">
            <span className="flex flex-wrap gap-1.5">
              {o.sectors.map((s) => (
                <Badge key={`sec-${s}`} tone="lit">{s}</Badge>
              ))}
              {o.skills.map((s) => (
                <Badge key={`skl-${s}`}>{s}</Badge>
              ))}
            </span>
          </Definition>
        </DefinitionList>
      )}
    </div>
  );
}
