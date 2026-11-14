import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";

// The masthead of every /admin/* page that wants one: where you are (the
// eyebrow, now PageHead's context line), the title, one line about it, and
// the way back to "Admin home". A thin wrapper over PageHead so every admin
// page opens the same way; the props are what they always were.
export function AdminPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <PageHead
      className="mb-8"
      context={eyebrow}
      title={title}
      lede={description}
      actions={
        <ButtonLink href="/admin" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={18} />}>
          {/* the arrow is drawn; the character stays in the accessible name, as it always was */}
          <span className="sr-only">← </span>Admin home
        </ButtonLink>
      }
    />
  );
}
