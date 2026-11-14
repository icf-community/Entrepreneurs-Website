import { useId, type ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";

// ════════════════════════════════════════════════════════════════════
// Foundry · SettingsSection (the account pages: /settings and /profile)
//
// Settings are a list of small decisions, so each one is a row: the title and
// the sentence that explains it at the side, the control beside them. Below
// 1280 px (a phone, a tablet, a desktop with the rail open and little room)
// the row stacks, title first. A hairline separates the rows; nothing is boxed,
// so the atmosphere shows through and the one boxed thing can be the one that
// matters.
//
//   tone="danger"   the delete-account zone: the same row, drawn as a Panel in the
//                   danger tone. It looks dangerous by its edge and its wash, not by
//                   being larger than the rest.
//
// A labelled landmark like Section (the title is its name). Server-safe: no
// state, so a client section can use it as well.
// ════════════════════════════════════════════════════════════════════

const ROW = "grid gap-x-12 gap-y-6 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]";
// The boxed row's own padding (p-8, 2 rem) moves its content right; a narrower first column puts its control back on the other rows' line.
const DANGER_ROW = "grid gap-x-12 gap-y-6 xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]";

export function SettingsSection({
  id,
  title,
  description,
  tone = "default",
  children,
}: {
  /** An anchor for the section (`#ai`, `#education`); the title's own id is derived from it. */
  id?: string;
  title: ReactNode;
  /** The sentence (or two) that explains the setting. Inline content only: it sits in a paragraph. */
  description?: ReactNode;
  tone?: "default" | "danger";
  children?: ReactNode;
}) {
  const auto = useId();
  const titleId = `${id ?? auto}-title`;
  const inner = (
    <>
      <div className="grid content-start gap-2">
        <h2 id={titleId} className="font-display text-title text-text-primary">
          {title}
        </h2>
        {description ? <p className="text-small leading-relaxed text-text-secondary">{description}</p> : null}
      </div>
      <div className="min-w-0 max-w-[34rem]">{children}</div>
    </>
  );

  if (tone === "danger") {
    return (
      <Panel as="section" tone="danger" id={id} aria-labelledby={titleId} className={`${DANGER_ROW} p-6 sm:p-8`}>
        {inner}
      </Panel>
    );
  }
  return (
    <section id={id} aria-labelledby={titleId} className={`${ROW} border-t border-border-subtle py-9`}>
      {inner}
    </section>
  );
}
