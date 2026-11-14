import type { CSSProperties, HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Table (Lumen)
//
// Real <table> semantics, drawn quietly. Four tables had four hand-built
// wrappers (and two of them no focusable scroll region); this is the one.
//
//   <Table label="Members with blocks or upheld reports">
//     <THead><TR><TH>Member</TH><TH numeric>Signals</TH><TH><span className="sr-only">Actions</span></TH></TR></THead>
//     <TBody>
//       <TR><TD label="Member" primary>Elena Petrova</TD><TD label="Signals" numeric>3</TD><TD actions><Button …/></TD></TR>
//     </TBody>
//   </Table>
//
// What you get for free:
//   * a scroll region that is focusable and named (`label`), so a keyboard can
//     pan a wide table (axe: scrollable-region-focusable);
//   * hairline rows, a tinted header that stays put when the region is given a
//     `maxHeight`, a row that lights when pointed at, an amber edge on a
//     `selected` row, comfortable density (or `density="compact"`);
//   * below 640 px of the table's own width (a container query, so a table in a
//     dialog or a narrow column stacks too) each row becomes a card with the
//     SAME DOM: the header row steps aside and every cell prints its own
//     `label` before its value. Give each TD its column's name as `label`;
//     mark the first cell `primary` and it becomes the card's title; mark a
//     cell of buttons `actions`. `narrow="scroll"` keeps the sideways scroll at
//     every width instead (for dense numeric tables); `minWidth` then sets how
//     wide the table is before it scrolls.
//   * explicit ARIA roles on every part, because browsers drop table semantics
//     when CSS changes a table's display (the stacked layout does), and the
//     roles put them back.
//
// A table that has no rows is an empty state, not an empty table: render the
// EmptyState instead. Server component: no state, no handlers.
// ════════════════════════════════════════════════════════════════════

// Redundant on purpose. Browsers discard a table's semantics once CSS changes an element's display, and the stacked layout does (Safari with
// VoiceOver on a phone, above all); an explicit role puts them back. They are read from this map, not written on the tags, so a linter that
// flags a role equal to the tag's default does not take the repair for noise.
const ROLE = { table: "table", rowgroup: "rowgroup", row: "row", cell: "cell" } as const;

export function Table({
  label,
  caption,
  captionVisible = false,
  narrow = "stack",
  density = "comfortable",
  minWidth,
  maxHeight,
  className = "",
  children,
}: {
  /** Names the scroll region (and so the table for someone moving by landmarks). Required. */
  label: string;
  /** The table's own title, announced with it; visually hidden unless `captionVisible`. */
  caption?: ReactNode;
  captionVisible?: boolean;
  narrow?: "stack" | "scroll";
  density?: "comfortable" | "compact";
  /** For narrow="scroll": the width below which the table scrolls sideways, e.g. "44rem". */
  minWidth?: string;
  /** Gives the region a height and its own vertical scroll, so the header stays in view. Ignored once the table stacks: a column of cards scrolls with the page. */
  maxHeight?: string;
  className?: string;
  children: ReactNode;
}) {
  const tableStyle = minWidth ? ({ "--lm-table-min": minWidth } as CSSProperties) : undefined;
  const regionStyle = maxHeight ? ({ "--lm-table-max": maxHeight } as CSSProperties) : undefined;
  return (
    <div className={`lm-tablebox ${className}`.trim()}>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="lm-tablescroll"
        data-narrow={narrow}
        data-tall={maxHeight ? "" : undefined}
        style={regionStyle}
      >
        <table
          role={ROLE.table}
          className="lm-table"
          data-narrow={narrow}
          data-density={density === "compact" ? "compact" : undefined}
          style={tableStyle}
        >
          {caption ? <caption className={captionVisible ? undefined : "sr-only"}>{caption}</caption> : null}
          {children}
        </table>
      </div>
    </div>
  );
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead role={ROLE.rowgroup} {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody role={ROLE.rowgroup} {...props} />;
}

export function TR({
  selected = false,
  ...rest
}: {
  /** The chosen row: a wash of warm light and an amber edge (and aria-selected). */
  selected?: boolean;
} & HTMLAttributes<HTMLTableRowElement>) {
  return <tr role={ROLE.row} data-selected={selected || undefined} aria-selected={selected || undefined} {...rest} />;
}

export function TH({
  scope = "col",
  numeric = false,
  ...rest
}: {
  /** "col" in the header row (default); "row" for a cell that names its row. */
  scope?: "col" | "row";
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
} & Omit<ThHTMLAttributes<HTMLTableCellElement>, "scope">) {
  return (
    <th
      scope={scope}
      role={scope === "row" ? "rowheader" : "columnheader"}
      data-numeric={numeric || undefined}
      {...rest}
    />
  );
}

export function TD({
  label,
  numeric = false,
  primary = false,
  actions = false,
  nowrap = false,
  ...rest
}: {
  /** The column's name, printed before the value when the table stacks. Leave it off for a cell that needs none. */
  label?: string;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
  /** The row's main cell: stronger ink, and the card's title when stacked. */
  primary?: boolean;
  /** A cell of buttons: right-aligned, never wrapped; left-aligned and wrapped when stacked. */
  actions?: boolean;
  nowrap?: boolean;
} & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      role={ROLE.cell}
      data-label={label}
      data-numeric={numeric || undefined}
      data-primary={primary || undefined}
      data-actions={actions || undefined}
      data-nowrap={nowrap || undefined}
      {...rest}
    />
  );
}
