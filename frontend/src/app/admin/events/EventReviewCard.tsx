"use client";

import { useState, useTransition } from "react";
import { approveEvent, rejectEvent } from "./actions";
import { track } from "@/lib/analytics/track";
import { formatDate, formatDateTime } from "@/lib/dates";
import { ErrorBanner } from "@/components/forms/Banners";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Disclosure } from "@/components/ui/Disclosure";
import { ApprovalActions, RejectionForm } from "@/components/admin/ReviewActions";
import { PosterContactDetails } from "@/components/admin/PosterContactDetails";
import { Icon } from "@/design-system/icons/Icon";
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
  editVersion: number;
};

// One row of the review queue: the summary is the whole header (a single button that opens the details),
// the approve / reject actions are always under it. The details are mounted only while open (`lazy`), as
// they were before: the description is not on the page until the card is opened.
export default function EventReviewCard({ ev }: { ev: Ev }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const submittedOn = formatDate(ev.createdAt);
  const when = formatDateTime(ev.eventAt);

  const handleApprove = () => {
    setError("");
    startTransition(async () => {
      const res = await approveEvent(ev.id, ev.editVersion);
      if (!res.ok) setError(res.error);
      else track("admin_listing_approved", { kind: "event", id: ev.id });
    });
  };

  const handleReject = () => {
    setError("");
    startTransition(async () => {
      const res = await rejectEvent(ev.id, reason);
      if (!res.ok) setError(res.error);
      else { track("admin_listing_rejected", { kind: "event", id: ev.id }); setShowReject(false); setReason(""); }
    });
  };

  return (
    <Disclosure
      as="article"
      size="sm"
      lazy
      closedLabel="Show details"
      openLabel="Hide details"
      summary={
        <>
          <span className="block font-display text-lead text-text-primary">{ev.title}</span>
          <span className="mt-1 block text-body text-text-secondary">
            <span className="data">{when}</span> · {ev.location} · Organised by {ev.organiserName}
          </span>
          <span className="mt-1 block text-small text-text-muted">
            Posted by <span className="text-text-secondary">{ev.postedBy.firstName} {ev.postedBy.surname}</span>
            {ev.postedBy.signupEmail && (<> · <span className="text-text-secondary">{ev.postedBy.signupEmail}</span></>)}
            {" · submitted "}<span className="data">{submittedOn}</span>
          </span>
        </>
      }
      footer={
        <>
          {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}
          {showReject ? (
            <RejectionForm
              id={`reason-${ev.id}`}
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
        </>
      }
    >
      <div className="grid gap-5 pt-4">
        <DefinitionList>
          <Definition term="Description">
            <p className="whitespace-pre-wrap leading-relaxed">{ev.description}</p>
          </Definition>
        </DefinitionList>
        <DefinitionList>
          <Definition term="Luma link">
            <a
              href={externalHref(ev.lumaLink)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-text-primary underline underline-offset-4 decoration-border-strong transition-colors hover:decoration-accent"
            >
              {ev.lumaLink}
              <span className="sr-only"> ↗</span>
              <Icon name="arrow-up-right" size={16} className="ml-1 inline-block align-text-bottom" />
            </a>
          </Definition>
        </DefinitionList>
        <PosterContactDetails
          postedBy={ev.postedBy}
          contactEmail={ev.contactEmail}
          contactEmailVisible={ev.contactEmailVisible}
        />
      </div>
    </Disclosure>
  );
}
