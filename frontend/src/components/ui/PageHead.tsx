import type { ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · PageHead (Lumen)
//
// A page's own opening: where you are (context), what it is (the title,
// Funnel Display light), one sentence about it (lede), and what you can do
// (actions). A hairline rule draws across the top as it scrolls into view and
// lights its end (motion.css, .rule-draw); the content rises behind it.
//
// This replaces about 36 hand-copied mastheads whose eyebrow, spacing and
// h1 clamp() had drifted apart. The title is the page's one <h1>.
//
// `context` is a trail, not a kicker: where this page sits (a breadcrumb or a
// back link). It is plain inline content; pass links as you would anywhere.
// ════════════════════════════════════════════════════════════════════

export function PageHead({
  title,
  lede,
  context,
  actions,
  as: Heading = "h1",
  className = "",
}: {
  title: ReactNode;
  lede?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <header className={`lm-pagehead rule-draw ${className}`}>
      {context ? <div className="lm-pagehead__context">{context}</div> : null}
      <div className="lm-pagehead__row">
        <div className="grid min-w-0 gap-3">
          <Heading className="lm-pagehead__title">{title}</Heading>
          {/* a sentence is a paragraph; anything richer (a Suspense count streaming in, a skeleton <div>) cannot sit inside a <p> without breaking hydration */}
          {lede ? (typeof lede === "string" ? <p className="lm-pagehead__lede">{lede}</p> : <div className="lm-pagehead__lede">{lede}</div>) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
