"use client";

import { useState, useTransition } from "react";
import { approveVcGrant, rejectVcGrant } from "./actions";
import { track } from "@/lib/analytics/track";
import { formatDate } from "@/lib/dates";
import { ErrorBanner } from "@/components/forms/Banners";
import { ApprovalActions, RejectionForm } from "@/components/admin/ReviewActions";
import { Badge } from "@/components/ui/Badge";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Disclosure } from "@/components/ui/Disclosure";
import { Icon } from "@/design-system/icons/Icon";
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

// Same row anatomy as the event and opportunity queues: a summary that opens the details, the approve and
// reject actions always under it.
export default function VcReviewCard({ vc: v }: { vc: Vc }) {
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
    <Disclosure
      as="article"
      size="sm"
      lazy
      closedLabel="Show details"
      openLabel="Hide details"
      summary={
        <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <span className="min-w-0">
            <span className="block font-display text-lead text-text-primary">{v.name}</span>
            <span className="mt-1 block text-body text-text-secondary">
              {v.stage  && <>{v.stage} · </>}
              {v.amount && <>{v.amount} · </>}
              {deadline ? <>Deadline <span className="data">{deadline}</span></> : "No deadline"}
            </span>
            <span className="mt-1 block text-small text-text-muted">
              Posted by <span className="text-text-secondary">{v.postedBy.firstName} {v.postedBy.surname}</span>
              {v.postedBy.signupEmail && (<> · <span className="text-text-secondary">{v.postedBy.signupEmail}</span></>)}
              {" · submitted "}<span className="data">{submittedOn}</span>
            </span>
          </span>
          <Badge tone="lit" className="shrink-0">{v.kind === "vc" ? "VC" : "Grant"}</Badge>
        </span>
      }
      footer={
        <>
          {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}
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
        </>
      }
    >
      <VcDetails v={v} />
    </Disclosure>
  );
}

function VcDetails({ v }: { v: Vc }) {
  return (
    <div className="grid gap-5 pt-4">
      <DefinitionList>
        <Definition term="Description">
          <p className="whitespace-pre-wrap leading-relaxed">{v.description}</p>
        </Definition>
      </DefinitionList>
      <DefinitionList>
        <Definition term="Link">
          <a
            href={externalHref(v.link)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-text-primary underline underline-offset-4 decoration-border-strong transition-colors hover:decoration-accent"
          >
            {v.link}
            <span className="sr-only"> ↗</span>
            <Icon name="arrow-up-right" size={16} className="ml-1 inline-block align-text-bottom" />
          </a>
        </Definition>
        <Definition term="Poster (signup email)">
          <p>{v.postedBy.signupEmail ?? "—"}</p>
          {v.postedBy.linkedinUrl && (
            <a
              href={externalHref(v.postedBy.linkedinUrl)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-small text-text-primary underline underline-offset-4 decoration-border-strong transition-colors hover:decoration-accent"
            >
              LinkedIn
              <span className="sr-only"> ↗</span>
              <Icon name="arrow-up-right" size={14} className="ml-1 inline-block align-text-bottom" />
            </a>
          )}
        </Definition>
      </DefinitionList>
    </div>
  );
}
