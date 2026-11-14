import type { ReactNode } from "react";
import AppShell from "@/components/app/AppShell";
import SubmittedBanner from "@/components/SubmittedBanner";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { Page } from "@/components/ui/Page";

// The chrome shared by /opportunities, /events and /vcs: nav, main
// landmark, the masthead (section name + heading + count), and the
// "post one" CTA.
// It was written out three times, and had already drifted — /vcs used a
// different heading wrapper from the other two.
//
// Deliberately not generalised past these three. /community and
// /my-bookmarks look similar but differ in ways that would turn this into
// a component with a prop per page.
//
// The masthead is PageHead: the section's name is its context line, the
// heading is the page's one h1, the count is the lede and the CTA is the page's
// one lit action. The column and the side margin are the system's (--gutter,
// --content-max); FilteredListLoadingSkeleton draws the same ones.
export default function ListingPageShell({
  active, isAdmin, justSubmitted, submittedKind,
  eyebrow, title, summary, cta, actions, children,
}: {
  active: "opportunities" | "events" | "vcs";
  isAdmin: boolean;
  justSubmitted: boolean;
  /** Noun for the post-submission banner, e.g. "opportunity". */
  submittedKind: string;
  eyebrow: string;
  title: string;
  /** One line under the heading, usually the item count. May be a suspended
   *  node when the count depends on the data being streamed in. PageHead sets a
   *  node that is not a plain string in a div, not a p: while the count streams
   *  in it is a block skeleton, and a div inside a p is re-parented by the
   *  browser. React then finds different HTML from the server's, throws
   *  hydration error #418 and re-renders the whole page on the client
   *  (D1: LCP 0.9 s → 3.7 s on a mid-range phone). */
  summary: ReactNode;
  /** A trailing "→" in the label is drawn as an icon; the character stays as
   *  visually hidden text, so the link's accessible name is unchanged. */
  cta: { href: string; label: string };
  /** Extra links beside the CTA (only /opportunities has any). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const label = cta.label.replace(/\s*→$/, "");
  const arrow = label !== cta.label;

  return (
    <AppShell active={active} isAdmin={isAdmin}>
      <Page>
        {justSubmitted && <SubmittedBanner kind={submittedKind} />}
        <PageHead
          className="mb-8"
          context={eyebrow}
          title={title}
          lede={summary}
          actions={
            <>
              {actions}
              <ButtonLink href={cta.href} variant="primary" size="md" lit>
                {label}
                {arrow && (
                  <>
                    <span className="sr-only"> →</span>
                    <Icon name="arrow-right" size={18} />
                  </>
                )}
              </ButtonLink>
            </>
          }
        />
        {children}
      </Page>
    </AppShell>
  );
}
