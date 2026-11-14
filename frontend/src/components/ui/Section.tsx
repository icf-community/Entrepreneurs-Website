import { useId } from "react";
import type { ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Section (Lumen)
//
// A page section with its own title row in the display face. Admin and
// settings pages hand-wrote this over and over (`mt-12 rule-draw pt-6` and a
// small label above the content); the spacing and the heading had drifted. A
// Section is a labelled landmark: its title is the heading that names it
// (aria-labelledby), `description` is one line under the title, and `actions`
// sit at the right of the title row.
//
//   level   2 (default, Funnel Display light at the title size) or 3 (regular,
//           at the lead size). A page has one h1 (PageHead); Sections are
//           its h2s, and a Section inside a Section is an h3.
//   rule    a hairline with a lit end across the top, the masthead's device
//           (the rule is for the sections of a long page, not every one)
//
// Sections stack on one rhythm: put them in a wrapper with the class
// `lm-sections` and the gap between them is `--section-gap` (data.css), the
// same on every page. Inside a section the title row and the content are
// `--section-gap-inner` apart.
//
// Server component.
// ════════════════════════════════════════════════════════════════════

export function Section({
  title,
  description,
  actions,
  level = 2,
  rule = false,
  id,
  className = "",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  rule?: boolean;
  /** An anchor for the section; the title's own id is derived from it. */
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  const auto = useId();
  const headingId = `${id ?? auto}-title`;
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section id={id} aria-labelledby={headingId} className={`lm-section ${className}`.trim()} data-rule={rule || undefined}>
      <div className="lm-section__head">
        <div className="lm-section__titles">
          <Heading id={headingId} className="lm-section__title" data-level={level === 3 ? "3" : undefined}>
            {title}
          </Heading>
          {description ? <p className="lm-section__desc">{description}</p> : null}
        </div>
        {actions ? <div className="lm-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
