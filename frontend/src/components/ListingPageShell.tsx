import Link from "next/link";
import type { ReactNode } from "react";
import AppShell from "@/components/app/AppShell";
import SubmittedBanner from "@/components/SubmittedBanner";

// The chrome shared by /opportunities, /events and /vcs: nav, main
// landmark, the masthead (section name + heading + count), and the
// "post one" CTA.
// It was written out three times, and had already drifted — /vcs used a
// different heading wrapper from the other two.
//
// Deliberately not generalised past these three. /community and
// /my-bookmarks look similar but differ in ways that would turn this into
// a component with a prop per page.
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
   *  node when the count depends on the data being streamed in. */
  summary: ReactNode;
  cta: { href: string; label: string };
  /** Extra links beside the CTA (only /opportunities has any). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell active={active} isAdmin={isAdmin}>
      <div className="px-4 py-10 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-[1200px]">
          {justSubmitted && <SubmittedBanner kind={submittedKind} />}
          {/* Same title-block grammar as the marketing sections: a rule
              across the measure, the section's name beneath it, the heading
              at the page's own left margin. `eyebrow` was previously a gold
              uppercase kicker floating above the h1 on all three of these
              pages — the words were already a column heading, they were just
              drawn as decoration. */}
          <header className="rule-draw mb-8 pt-4">
            <p className="label-wide mb-6 text-text-muted">{eyebrow}</p>
            <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
              <div className="min-w-0">
                <h1 className="text-[clamp(1.8rem,3.4vw,2.6rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-text-primary">
                  {title}
                </h1>
                {/* A div, not a p: while the count streams in, `summary` is a
                    block skeleton, and a div inside a p is re-parented by the
                    browser. React then finds different HTML from the server's,
                    throws hydration error #418 and re-renders the whole page
                    on the client (D1: LCP 0.9 s → 3.7 s on a mid-range phone). */}
                <div className="mt-3 text-body leading-relaxed text-text-muted">{summary}</div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {actions}
                <Link
                  href={cta.href}
                  className="rounded-lg bg-accent px-4 py-2 text-body font-semibold text-bg-primary no-underline transition-colors duration-150 hover:bg-accent-dim"
                >
                  {cta.label}
                </Link>
              </div>
            </div>
          </header>
          {children}
        </div>
      </div>
    </AppShell>
  );
}
