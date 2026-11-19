"use client";

import { useState, useTransition } from "react";
import { approveUser, rejectUser } from "./actions";
import { track } from "@/lib/analytics/track";
import SocialLinks from "@/components/SocialLinks";
import { formatDate } from "@/lib/dates";
import { ErrorBanner } from "@/components/forms/Banners";
import { ApprovalActions, RejectionForm } from "@/components/admin/ReviewActions";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Panel } from "@/components/ui/Panel";
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
  const fullName = `${member.firstName} ${member.surname}`;

  return (
    <Panel as="article" className="grid gap-5 p-5 sm:p-6">
      <header className="flex items-start gap-4">
        <Avatar name={fullName} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="font-display text-lead text-text-primary">
              {member.firstName} {member.surname}
            </h2>
            {member.previouslyBanned && (
              <Badge
                tone="danger"
                dot
                title="A past account using this email address was rejected and the account later deleted."
              >
                Previously banned
              </Badge>
            )}
          </div>
          <p className="mt-1 text-small text-text-muted">
            {member.role === "alum" ? `Alum · grad ${member.gradYear ?? "—"}` : `Student · class of ${member.gradYear ?? "—"}`}
            {" · submitted "}{submitted}
          </p>
          {member.course && (
            <p className="mt-0.5 text-small text-text-secondary">{member.course}</p>
          )}
        </div>
      </header>

      <MemberDetails member={member} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

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
    </Panel>
  );
}

function MemberDetails({ member }: { member: Member }) {
  const hasTags = member.sectors.length > 0 || member.skills.length > 0;
  const hasLinks = member.linkedinUrl || member.githubUrl || member.portfolioUrl;

  return (
    <>
      {(member.bio || member.workingOn) && (
        <DefinitionList min="lg">
          {member.bio && <Definition term="Bio">{member.bio}</Definition>}
          {member.workingOn && <Definition term="Working on">{member.workingOn}</Definition>}
        </DefinitionList>
      )}

      {(hasTags || hasLinks) && (
        <div className="flex flex-col gap-3">
          {hasTags && (
            <div className="flex flex-wrap gap-1.5">
              {member.sectors.map((s) => (
                <Badge key={`sec-${s}`} tone="lit">{s}</Badge>
              ))}
              {member.skills.map((s) => (
                <Badge key={`skl-${s}`}>{s}</Badge>
              ))}
            </div>
          )}
          <SocialLinks linkedinUrl={member.linkedinUrl} githubUrl={member.githubUrl} portfolioUrl={member.portfolioUrl} />
        </div>
      )}
    </>
  );
}
