import type { ReactNode } from "react";
import { externalHref } from "@/lib/safeUrl";

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-small text-text-muted mb-1">{label}</div>
      {children}
    </div>
  );
}

// Shared by EventReviewCard and OpportunityReviewCard: the poster's signup
// email + LinkedIn next to the listing's own public contact email, side by
// side so a reviewer can see at a glance whether they match.
export function PosterContactDetails({
  postedBy,
  contactEmail,
  contactEmailVisible,
}: {
  postedBy: { signupEmail: string | null; linkedinUrl: string | null };
  contactEmail: string;
  contactEmailVisible: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <DetailBlock label="Poster (signup email)">
        <p className="text-body text-text-secondary">{postedBy.signupEmail ?? "—"}</p>
        {postedBy.linkedinUrl && (
          <a href={externalHref(postedBy.linkedinUrl)} target="_blank" rel="noreferrer noopener" className="text-small text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent">LinkedIn ↗</a>
        )}
      </DetailBlock>
      <DetailBlock label="Public contact email">
        <p className="text-body text-text-secondary">
          {contactEmail}
          <span className="text-text-muted ml-2 text-small">
            ({contactEmailVisible ? "visible to members" : "hidden"})
          </span>
        </p>
      </DetailBlock>
    </div>
  );
}
