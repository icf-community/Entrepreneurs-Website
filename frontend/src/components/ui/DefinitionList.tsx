import type { ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · DefinitionList and Definition (Lumen)
//
// Terms and what they mean: the facts on a listing's page (Pay, Apply by,
// Starts, Location), the fields of a dialog, the lines of a summary. It was
// the Fact grid, whose labels were tracked capitals; here a term is a small
// sentence-case label and the definition is the thing. Real <dl>/<dt>/<dd>,
// each pair wrapped in a div, so a screen reader hears the pairs.
//
//   <DefinitionList>
//     <Definition term="Pay">{o.pay}</Definition>
//     <Definition term="Apply by">{formatDate(o.applicationDeadline)}</Definition>
//   </DefinitionList>
//
// A Definition with an empty value renders nothing (as Fact did), so a page can
// list every possible fact and let the missing ones fall away. Or pass `items`.
//
//   layout="grid"    pairs reflow to the room there is (default)
//   layout="inline"  one ruled column, term left and definition right: for dialogs
//   min              how narrow a pair gets before the grid drops a column
//   strong           the definitions in primary ink, for a summary that is the point
//
// Server component.
// ════════════════════════════════════════════════════════════════════

export function Definition({ term, children }: { term: ReactNode; children?: ReactNode }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function DefinitionList({
  items,
  layout = "grid",
  min = "md",
  strong = false,
  className = "",
  children,
}: {
  /** Pairs from data; terms are the keys, so they must differ. For anything else, write <Definition> children. */
  items?: readonly { term: string; definition: ReactNode }[];
  layout?: "grid" | "inline";
  min?: "sm" | "md" | "lg";
  strong?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <dl
      className={`lm-deflist ${className}`.trim()}
      data-layout={layout === "inline" ? "inline" : undefined}
      data-min={min === "md" ? undefined : min}
      data-tone={strong ? "strong" : undefined}
    >
      {items?.map((item) => (
        <Definition key={item.term} term={item.term}>
          {item.definition}
        </Definition>
      ))}
      {children}
    </dl>
  );
}
