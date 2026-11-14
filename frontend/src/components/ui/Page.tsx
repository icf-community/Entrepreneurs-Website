import type { ReactNode } from "react";

// ═════════════════════════════════════════════════════════════════
// Foundry · Page (Lumen)
//
// The frame a page's content sits in. Every page opens with this, so the head
// starts at the same place on each: the same side margin, the same space above
// and below, and a column whose left edge does not move. (Pages used to build
// their own wrapper, and a title jumped sideways and up and down as you went
// from one page to the next.) The look of all of it is components.css
// (`.lm-page`, `.lm-col`) and the tokens `--content-max`, `--col-page`,
// `--col-narrow`, `--page-top` and `--page-bottom`.
//
//   width   "wide" (the default): lists, dashboards and settings, up to --content-max.
//           "page": one column of 820 px: a feed, a detail, a form.
//           "narrow": 640 px: a short form or a single message.
//           A page of one column starts at the frame's left edge; it is not centred.
//   align   "center" centres a narrow column. Only for a page with no rail beside it
//           (a visitor's contact page), where the column is the one thing on the screen.
//   as      "main" for a page that is its own landmark (the admin pages: no AppShell
//           around them); everywhere else AppShell already provides <main>.
// ═════════════════════════════════════════════════════════════════

export function Page({
  width = "wide",
  align,
  as = "div",
  className = "",
  children,
}: {
  width?: "wide" | "page" | "narrow";
  align?: "center";
  as?: "div" | "main";
  className?: string;
  children: ReactNode;
}) {
  const column = (
    <div className="lm-col" data-width={width === "wide" ? undefined : width} data-align={align}>
      {children}
    </div>
  );
  return as === "main" ? (
    <main id="main-content" tabIndex={-1} className={`lm-page ${className}`}>
      {column}
    </main>
  ) : (
    <div className={`lm-page ${className}`}>{column}</div>
  );
}
