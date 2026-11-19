import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Icon } from "@/design-system/icons/Icon";
import { externalHref } from "@/lib/safeUrl";

// Shared by EventReviewCard and OpportunityReviewCard: the poster's signup
// email + LinkedIn next to the listing's own public contact email, side by
// side so a reviewer can see at a glance whether they match. Two terms and
// what they mean, so it is a definition list (the card's other facts are too).
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
    <DefinitionList min="lg">
      <Definition term="Poster (signup email)">
        <span className="block break-words">{postedBy.signupEmail ?? "—"}</span>
        {postedBy.linkedinUrl && (
          <a
            href={externalHref(postedBy.linkedinUrl)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex min-h-6 items-center gap-1 text-small text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent"
          >
            LinkedIn
            {/* the arrow is drawn; the character stays in the accessible name, as it always was */}
            <span className="sr-only"> ↗</span>
            <Icon name="arrow-up-right" size={16} />
          </a>
        )}
      </Definition>
      <Definition term="Public contact email">
        <span className="break-words">{contactEmail}</span>
        <span className="ml-2 text-small text-text-muted">
          ({contactEmailVisible ? "visible to members" : "hidden"})
        </span>
      </Definition>
    </DefinitionList>
  );
}
