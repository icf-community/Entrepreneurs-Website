import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { PublicHeader } from "@/app/login/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { Page } from "@/components/ui/Page";
import { PageHead } from "@/components/ui/PageHead";
import { Section } from "@/components/ui/Section";
import { Trail } from "@/components/ui/Trail";

// ════════════════════════════════════════════════════════════════════
// Foundry · a long legal document (Lumen)
//
// The shell of /privacy, /terms, /cookies and /ai-notice: the signed-out header (the brand, and nothing else: the
// way back is the trail below), a page's opening (PageHead: the way back and where it sits as its trail, the title,
// when it was last updated), then the document, then the signed-out footer. The words of the document are the pages'
// own and are not touched here: a page hands its sections in as children.
//
// What makes it a good read:
//   * the prose is held to about 70 characters a line (tables may take the whole column), at 1.625 line height,
//     in the secondary ink, with each section opening on a Funnel Display title at the section scale. The cap is
//     52ch, not 70: a `ch` is the width of a zero (10.4 px at this size) and an average letter is 7.6 px, so 70ch
//     ran to about 96 characters;
//   * the sections keep the system's one rhythm (`lm-sections`), so a long document breathes the way every
//     other long page does;
//   * from a wide screen up a quiet contents rail stays beside the text (sticky, scrolls inside itself when
//     the document has more sections than the screen has height). It is made from the sections' own titles,
//     and each title is the anchor of its section, so nothing in it is a second copy of the words;
//     below that width the document simply reads down the page.
//
// A server component with no request data, because the four pages are static routes (lib/csp.ts STATIC_CSP_ROUTES):
// the header and the footer it carries read none either.
// It lives under app/privacy because the partition has no shared folder for a new component; the lead may move it
// to components/ (terms, cookies and ai-notice import it from here).
// ════════════════════════════════════════════════════════════════════

/** "2a. Your CV: what we do, and don't do, with it" becomes "2a-your-cv-what-we-do-and-dont-do-with-it". */
function anchor(title: string) {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The titles of the sections inside `children`, in order. A page may hand its sections in as fragments (a long document is written in parts), so those are looked through. */
function sectionTitles(children: ReactNode): string[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ title?: unknown; children?: ReactNode }>(child)) return [];
    if (child.type === Fragment) return sectionTitles(child.props.children);
    return typeof child.props.title === "string" ? [child.props.title] : [];
  });
}

/** One titled part of a document. Its title is its anchor, and the contents rail is read from it. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section id={anchor(title)} title={title}>
      {/* one block, so the paragraphs and lists keep the rhythm they were written with (a Section lays its children out as a grid) */}
      <div>{children}</div>
    </Section>
  );
}

export function LegalDocument({
  back,
  kicker,
  title,
  updated,
  children,
}: {
  /** The way back: where it goes and what it is called. */
  back: { href: string; label: string };
  /** Where the document sits ("Legal"), shown after the way back in the trail. */
  kicker?: string;
  title: string;
  /** The date the document was last updated, as the page words it. */
  updated: string;
  /** The document's <LegalSection>s. */
  children: ReactNode;
}) {
  const titles = sectionTitles(children);

  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />

      {/* the page frame, so the document's head sits where every other page's does under its bar */}
      <Page as="main" className="flex-1">
        <div className="mx-auto max-w-[1140px]">
          <PageHead
            context={<Trail href={back.href} label={back.label} current={kicker || undefined} />}
            title={title}
            lede={`Last updated: ${updated}.`}
          />

          <div className="mt-10 grid gap-10 xl:grid-cols-[14rem_minmax(0,1fr)] xl:gap-16">
            {titles.length > 1 ? (
              <nav aria-label="Contents" className="hidden xl:block">
                <ol className="sticky top-8 grid max-h-[calc(100svh-4rem)] gap-0.5 overflow-y-auto text-small">
                  {titles.map((t) => (
                    <li key={t}>
                      <a
                        href={`#${anchor(t)}`}
                        className="block rounded-lg px-3 py-2 leading-snug text-text-muted no-underline transition-colors duration-150 hover:bg-tint-2 hover:text-text-primary"
                      >
                        {t}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}

            <article className="lm-sections min-w-0 max-w-[40rem] text-body leading-relaxed text-text-secondary [overflow-wrap:anywhere] [&_p]:max-w-[52ch] [&_ul]:max-w-[52ch]">
              {children}
            </article>
          </div>
        </div>
      </Page>

      <PublicFooter />
    </div>
  );
}
