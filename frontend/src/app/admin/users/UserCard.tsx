"use client";

import { useState, useTransition } from "react";
import { approveUser, rejectUser } from "./actions";
import { track } from "@/lib/analytics/track";
import SocialLinks from "@/components/SocialLinks";
import { formatDate } from "@/lib/dates";
import { ErrorBanner } from "@/components/forms/Banners";
import { ApprovalActions, RejectionForm } from "@/components/admin/ReviewActions";
import type { Affiliation } from "@/lib/intake/steps";

type Member = {
  id: string;
  firstName: string;
  surname: string;
  role: Affiliation;
  course: string | null;
  gradYear: number | null;
  bio: string | null;
  workingOn: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  createdAt: string;
  skills: string[];
  sectors: string[];
  previouslyBanned: boolean;
};

export default function UserCard({ member }: { member: Member }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const handleApprove = () => {
    setError("");
    startTransition(async () => {
      const res = await approveUser(member.id);
      if (!res.ok) setError(res.error);
      else track("admin_member_approved", { userId: member.id });
    });
  };

  const handleReject = () => {
    setError("");
    startTransition(async () => {
      const res = await rejectUser(member.id, reason);
      if (!res.ok) {
        setError(res.error);
      } else {
        track("admin_member_rejected", { userId: member.id });
        setShowReject(false);
        setReason("");
      }
    });
  };

  const submitted = formatDate(member.createdAt);

  return (
    <article className="rounded-2xl bg-bg-card border border-border p-6">
      <header className="mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-lead font-medium text-text-primary">
            {member.firstName} {member.surname}
          </div>
          {member.previouslyBanned && (
            <span
              className="px-2 py-0.5 rounded-lg text-small font-medium bg-red-500/10 text-red-400 border border-red-500/30"
              title="A past account using this email address was rejected and the account later deleted."
            >
              Previously banned
            </span>
          )}
        </div>
        <div className="text-small text-text-muted mt-1">
          {member.role === "alum" ? `Alum · grad ${member.gradYear ?? "—"}` : `Student · class of ${member.gradYear ?? "—"}`}
          {" · submitted "}{submitted}
        </div>
        {member.course && (
          <div className="text-small text-text-secondary mt-1">{member.course}</div>
        )}
      </header>

      <MemberDetails member={member} />

      {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}

      {showReject ? (
        <RejectionForm
          id={`reason-${member.id}`}
          reason={reason}
          onReasonChange={setReason}
          placeholder="e.g. Could not verify Imperial affiliation from LinkedIn."
          label="Reason for rejection (internal — not shown to the user)"
          confirmLabel="Confirm rejection + send email"
          pending={pending}
          onConfirm={handleReject}
          onCancel={() => { setShowReject(false); setReason(""); setError(""); }}
        />
      ) : (
        <ApprovalActions pending={pending} onApprove={handleApprove} onReject={() => setShowReject(true)} />
      )}
    </article>
  );
}

function MemberDetails({ member }: { member: Member }) {
  const hasTags = member.sectors.length > 0 || member.skills.length > 0;
  const hasLinksOrTags = hasTags || member.linkedinUrl || member.githubUrl || member.portfolioUrl;

  return (
    <>
      {member.bio && (
        <div className="mb-3">
          <div className="text-small text-text-muted mb-1">Bio</div>
          <p className="text-body text-text-secondary leading-relaxed">{member.bio}</p>
        </div>
      )}

      {member.workingOn && (
        <div className="mb-3">
          <div className="text-small text-text-muted mb-1">Working on</div>
          <p className="text-body text-text-secondary leading-relaxed">{member.workingOn}</p>
        </div>
      )}

      {hasLinksOrTags && (
        <div className="mb-4 flex flex-col gap-3">
          {hasTags && (
            <div className="flex flex-wrap gap-1.5">
              {member.sectors.map((s) => (
                <span key={`sec-${s}`} className="px-2 py-0.5 rounded-lg text-small bg-accent-muted text-accent-light border border-accent/20">{s}</span>
              ))}
              {member.skills.map((s) => (
                <span key={`skl-${s}`} className="px-2 py-0.5 rounded-lg text-small bg-tint-1 text-text-secondary border border-border">{s}</span>
              ))}
            </div>
          )}
          <SocialLinks linkedinUrl={member.linkedinUrl} githubUrl={member.githubUrl} portfolioUrl={member.portfolioUrl} />
        </div>
      )}
    </>
  );
}

