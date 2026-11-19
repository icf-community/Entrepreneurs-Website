"use client";

import { useId, useState } from "react";
import type { ReactNode, TransitionEvent } from "react";
import { Icon } from "@/design-system/icons/Icon";
import { Panel, type PanelTone } from "./Panel";

// ════════════════════════════════════════════════════════════════════
// Foundry · Disclosure and Collapse (Lumen)
//
// The expandable card. Five listing cards (opportunities, events, VCs, and the
// admin review cards) each hand-rolled the same thing with their own glyph
// (▸ / ▾ in the label) and their own conditional render. This is the one.
//
//   <Disclosure
//     as="article" id={`o-${id}`}
//     summary={<>title, meta, tags</>}                 // everything that is the card's header
//     closedLabel="Show details" openLabel="Hide details"
//     trailing={<>· Apply by {deadline}</>}            // optional words after the label
//     accessory={<BookmarkButton … />}                 // a control that sits on the card, outside the button
//     footer={<ApprovalActions … />}                  // always visible, under the panel
//   >
//     {details}
//   </Disclosure>
//
// The header is ONE button holding the whole summary (aria-expanded,
// aria-controls), so the card's title is read once and the control keeps the
// accessible name it always had: the summary, then "Show details" (or "Hide
// details" when open). The chevron turns; the panel opens by the grid-rows
// trick, so its height animates without being measured.
//
// CLOSED CONTENT. By default the details stay in the DOM, hidden from sight and
// from the keyboard (visibility and `inert`). A card whose spec asserts that the
// description is NOT on the page until the card is opened (urlfilters.spec.ts
// does, for the opportunity card) passes `lazy`: the children are mounted only
// while the panel is open or closing. Pass the details as children in both
// cases; do not write `{open && …}` yourself, it unmounts them before the panel
// can close.
//
// State is the caller's when `open` is given (needed when opening has side
// effects: a freshness check, an analytics event, which keep living in the
// page's own effect keyed on its `open`), otherwise `defaultOpen` and the
// Disclosure's own.
//
// Collapse is the panel alone, for a separate button that is not the whole
// header (the AI result's "Why this match"): `aria-expanded` and `aria-controls`
// stay on your button, `id` here.
// ════════════════════════════════════════════════════════════════════

export function Collapse({
  open,
  id,
  lazy = false,
  className = "",
  onTransitionEnd,
  children,
}: {
  open: boolean;
  /** The id your button's aria-controls points at. */
  id?: string;
  /** Mount the children only while open. (A Disclosure also keeps them while it closes; a bare Collapse unmounts at once.) */
  lazy?: boolean;
  className?: string;
  onTransitionEnd?: (event: TransitionEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div id={id} className={`lm-collapse ${className}`.trim()} data-open={open || undefined} onTransitionEnd={onTransitionEnd}>
      <div className="lm-collapse__inner" inert={!open}>
        {lazy && !open ? null : children}
      </div>
    </div>
  );
}

export function Disclosure({
  as = "article",
  id,
  summary,
  closedLabel,
  openLabel,
  trailing,
  accessory,
  footer,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  lazy = false,
  tone = "default",
  size = "md",
  className = "",
  children,
}: {
  as?: "article" | "section" | "div" | "li";
  id?: string;
  /** The card's header content: it all sits inside the one button. Phrasing content is best (spans), headings work. */
  summary: ReactNode;
  /** The words on the trigger while closed ("Show details") … */
  closedLabel: string;
  /** … and while open ("Hide details"). */
  openLabel: string;
  /** More words on the trigger's last line, after the label: <>· Apply by 12 Nov</>. */
  trailing?: ReactNode;
  /** A control placed on the card's top corner, outside the button, so a click on it never toggles the card. */
  accessory?: ReactNode;
  /** Always visible, under the panel (actions that do not depend on the card being open). */
  footer?: ReactNode;
  /** Controlled state. Omit it to let the Disclosure keep its own. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Mount the details only while open (and while closing), instead of keeping them in the DOM. */
  lazy?: boolean;
  tone?: PanelTone;
  size?: "sm" | "md";
  className?: string;
  /** The details. */
  children: ReactNode;
}) {
  const panelId = useId();
  const [own, setOwn] = useState(defaultOpen);
  // A lazy panel keeps its content while the close transition runs, then lets it go.
  const [closing, setClosing] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : own;

  const toggle = () => {
    const next = !open;
    if (!next && lazy) setClosing(true);
    if (!controlled) setOwn(next);
    onOpenChange?.(next);
  };

  const settle = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === "grid-template-rows" && !open) setClosing(false);
  };

  return (
    <Panel
      as={as}
      id={id}
      tone={tone}
      className={`lm-disclosure ${className}`.trim()}
      data-open={open || undefined}
      data-pad={size === "sm" ? "sm" : undefined}
      data-accessory={accessory ? "" : undefined}
    >
      {accessory ? <div className="lm-disclosure__accessory">{accessory}</div> : null}
      <button type="button" className="lm-disclosure__trigger" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        <span className="lm-disclosure__summary">{summary}</span>
        <span className="lm-disclosure__state">
          <Icon name="chevron-down" size={16} className="lm-disclosure__chev" />
          <span className="lm-disclosure__label">{open ? openLabel : closedLabel}</span>
          {trailing}
        </span>
      </button>
      <Collapse id={panelId} open={open} onTransitionEnd={settle}>
        <div className="lm-disclosure__body">{lazy && !open && !closing ? null : children}</div>
      </Collapse>
      {footer ? <div className="lm-disclosure__foot">{footer}</div> : null}
    </Panel>
  );
}
