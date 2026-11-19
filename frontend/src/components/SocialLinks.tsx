import { ButtonLink } from "@/components/ui/ButtonLink";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";
import { externalHref } from "@/lib/safeUrl";

type Props = {
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl?: string | null;
};

// A member's links, each a quiet outlined pill with its mark in front (the icon set's own LinkedIn, GitHub and globe) and its name after it.
// Every href goes through externalHref: http and https only, and anything else fails to a non-link. A pill with no safe address is drawn
// as the same pill, off (no link, no accessible name beyond its words), rather than as a link that goes nowhere or somewhere unchecked.
function Pill({ href, name, label, icon }: { href: string | undefined; name: string; label: string; icon: IconName }) {
  const mark = <Icon name={icon} size={16} />;
  if (!href) {
    return (
      <span className="lm-btn" data-variant="ghost" data-size="sm" aria-disabled="true">
        {mark}
        {name}
      </span>
    );
  }
  return (
    <ButtonLink
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      variant="ghost"
      size="sm"
      leading={mark}
    >
      {name}
    </ButtonLink>
  );
}

export default function SocialLinks({ linkedinUrl, githubUrl, portfolioUrl }: Props) {
  if (!linkedinUrl && !githubUrl && !portfolioUrl) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {linkedinUrl && <Pill href={externalHref(linkedinUrl)} name="LinkedIn" label="LinkedIn profile" icon="linkedin" />}
      {githubUrl && <Pill href={externalHref(githubUrl)} name="GitHub" label="GitHub profile" icon="github" />}
      {portfolioUrl && <Pill href={externalHref(portfolioUrl)} name="Portfolio" label="Portfolio site" icon="globe" />}
    </div>
  );
}
