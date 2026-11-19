import type { ReactNode } from "react";

/**
 * Lumen's ring for something drawn small: a UI icon or a figure-only glyph inside a circle with a firm edge. It is the `.lm-disc` class
 * (components.css), which Entry already wraps its glyph slot in; use this component where you need the same ring outside an Entry (a
 * login step, an empty state, a settings row) so no page pastes the classes.
 *
 *   size   sm 36 px · md 44 px (the default) · lg 56 px
 *   lit    the ring and its contents glow warm: the current or chosen one. At most one per view.
 *
 * What goes inside, by size (the ring is 1.5 px, so the free circle is a little smaller than the box):
 *   sm  <Icon size={16 | 18} />
 *   md  <Icon size={20} />  or  <Glyph ring={false} size={28} />
 *   lg  <Icon size={24} />  or  <Glyph ring={false} size={34} />
 *
 * A Glyph already draws its own ring, so inside a Disc it is `ring={false}`: a ring in a ring is two nested borders. A Glyph on its own
 * (a hero, an empty state) keeps its ring and needs no Disc. An Icon on its own (a button, a link, a row) needs no Disc either: the Disc is
 * for identity, not for every icon.
 */
export function Disc({
  size = "md",
  lit = false,
  className = "",
  children,
}: {
  size?: "sm" | "md" | "lg";
  lit?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className={`lm-disc ${className}`.trim()} data-size={size === "md" ? undefined : size} data-lit={lit ? "" : undefined}>
      {children}
    </span>
  );
}
