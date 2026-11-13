import Link from "next/link";
import type { ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Entry (Lumen)
//
// One row of a list: a glyph in Lumen's ring, a title, a line of meta, and a
// trailing control. Members, listings, notifications and settings rows are all
// this shape. With `href` the title becomes a stretched link (the whole row is
// the target, one link in the accessibility tree, no nested interactive
// elements); trailing controls sit above the stretch so they stay clickable.
// ════════════════════════════════════════════════════════════════════

export function Entry({
  as: Tag = "div",
  glyph,
  title,
  meta,
  trailing,
  href,
  lit = false,
  className = "",
  children,
}: {
  as?: "div" | "li" | "article";
  /** An identity glyph or avatar, placed in a ring. */
  glyph?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  /** The ring glows: this is the current or chosen entry. */
  lit?: boolean;
  className?: string;
  /** Anything that belongs under the title and meta (tags, a description). */
  children?: ReactNode;
}) {
  return (
    <Tag className={`lm-entry ${className}`} data-glyph={glyph ? "" : undefined}>
      {glyph ? (
        <span className="lm-disc" data-lit={lit || undefined}>
          {glyph}
        </span>
      ) : null}
      <div className="min-w-0">
        <div className="lm-entry__title">
          {href ? (
            <Link href={href} className="text-inherit no-underline after:absolute after:inset-0 after:content-['']">
              {title}
            </Link>
          ) : (
            title
          )}
        </div>
        {meta ? <div className="lm-entry__meta">{meta}</div> : null}
        {children}
      </div>
      {trailing ? <div className="relative z-10 flex items-center gap-2">{trailing}</div> : null}
    </Tag>
  );
}
