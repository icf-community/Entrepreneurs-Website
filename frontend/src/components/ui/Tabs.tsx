"use client";

import { createContext, useCallback, useContext, useId, useMemo, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { tabClass, tabsClass, type TabsSize, type TabsVariant } from "./tabsClass";

// ════════════════════════════════════════════════════════════════════
// Foundry · Tabs (Lumen)
//
// One look, three kinds of markup. There were seven hand-rolled tab and
// toggle strips, and they did not agree on what they were: some were buttons
// with aria-current, some buttons with aria-pressed, some buttons with no
// state at all, one a real tablist. The look is now one thing (data.css,
// .lm-tabs) and the semantics stay with the site, because a test or a screen
// reader depends on them:
//
//   ButtonTabs  buttons, client state or a client-side URL change.
//               semantics="pressed"  → aria-pressed on every button (a toggle:
//                                      List | Month, Sign up | Log in)
//               semantics="current"  → aria-current="page" on the current one,
//                                      inside a <nav aria-label> (a place you
//                                      are: Open | Actioned | Dismissed)
//   LinkTabs    real links, aria-current="page", the URL is the state (see
//               LinkTabs.tsx; it needs no JavaScript).
//   Tabs / TabList / Tab / TabPanel
//               a true ARIA tablist with a roving tabindex and arrow keys. Use
//               it only where the panel really is a panel of the same page.
//
// Nothing here ever adds role="tab" to a button or a link that a spec or a
// reader expects to be one. A site that has to keep its own markup uses
// tabsClass() and tabClass from ./tabsClass instead of these components.
// ════════════════════════════════════════════════════════════════════

export type ButtonTabItem<T extends string = string> = {
  value: T;
  /** The visible label. A count or a note belongs here (see TabCount), so it stays part of the accessible name. */
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  /** Overrides the accessible name when the visible label is not enough. */
  ariaLabel?: string;
};

type ButtonTabsBase<T extends string> = {
  items: readonly ButtonTabItem<T>[];
  /** The current item's value. */
  value: T;
  /** Called with the clicked item's value, also when it is already current (a site may re-apply its URL state). */
  onSelect: (value: T) => void;
  variant?: TabsVariant;
  size?: TabsSize;
  fill?: boolean;
  /** Disables every item, e.g. while a navigation is in flight; the current one keeps its light. */
  disabled?: boolean;
  className?: string;
};

/** A place you are: a <nav> that needs its name. */
type CurrentTabs = { semantics: "current"; label: string };
/** A toggle: a group that may be named. */
type PressedTabs = { semantics?: "pressed"; label?: string };

export function ButtonTabs<T extends string>({
  items,
  value,
  onSelect,
  label,
  semantics = "pressed",
  variant = "line",
  size = "md",
  fill = false,
  disabled = false,
  className = "",
}: ButtonTabsBase<T> & (CurrentTabs | PressedTabs)) {
  const strip = tabsClass({ variant, size, fill, className });
  const buttons = items.map((item) => {
    const selected = item.value === value;
    return (
      <button
        key={item.value}
        type="button"
        disabled={disabled || item.disabled}
        title={item.title}
        aria-label={item.ariaLabel}
        aria-current={semantics === "current" ? (selected ? "page" : undefined) : undefined}
        aria-pressed={semantics === "pressed" ? selected : undefined}
        className={tabClass}
        onClick={() => onSelect(item.value)}
      >
        {item.label}
      </button>
    );
  });
  return semantics === "current" ? (
    <nav aria-label={label} className={strip}>
      {buttons}
    </nav>
  ) : (
    <div role={label ? "group" : undefined} aria-label={label} className={strip}>
      {buttons}
    </div>
  );
}

/** A count or note inside a tab's label, quieter than the words: <>Requests <TabCount>3</TabCount></>. */
export function TabCount({ children }: { children: ReactNode }) {
  return <span className="lm-tab__count">{children}</span>;
}

// ── True tabs ──────────────────────────────────────────────────────────────────────────────────────────────

type TabsContext = {
  base: string;
  value: string;
  select: (value: string) => void;
  panels: boolean;
  activation: "auto" | "manual";
  orientation: "horizontal" | "vertical";
  variant: TabsVariant;
  size: TabsSize;
  fill: boolean;
};

const TabsCtx = createContext<TabsContext | null>(null);

function useTabs(part: string): TabsContext {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error(`<${part}> must be rendered inside <Tabs>.`);
  return ctx;
}

// A value may hold spaces or punctuation; ids and aria-controls may not.
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
const tabId = (base: string, value: string) => `${base}-tab-${safe(value)}`;
const panelId = (base: string, value: string) => `${base}-panel-${safe(value)}`;

/**
 * The root of a true tablist. Controlled (`value` + `onValueChange`) or not (`defaultValue`).
 * `activation="manual"` (the default) moves focus with the arrow keys and selects with Enter or Space, so a tab that costs a request
 * is never fired by passing over it; `"auto"` selects as focus arrives, for panels that are already on the page.
 * `panels={false}` when the tabs switch something that is not a TabPanel (then no aria-controls points at nothing).
 */
export function Tabs<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  panels = true,
  activation = "manual",
  orientation = "horizontal",
  variant = "line",
  size = "md",
  fill = false,
  className = "",
  children,
}: {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  panels?: boolean;
  activation?: "auto" | "manual";
  orientation?: "horizontal" | "vertical";
  variant?: TabsVariant;
  size?: TabsSize;
  fill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const base = useId();
  const [own, setOwn] = useState(defaultValue ?? "");
  const controlled = value !== undefined;
  const current = controlled ? value : own;
  const select = useCallback(
    (next: string) => {
      if (!controlled) setOwn(next);
      // every Tab's `value` is a string the caller wrote, so it is one of the caller's own T
      onValueChange?.(next as T);
    },
    [controlled, onValueChange],
  );
  const ctx = useMemo<TabsContext>(
    () => ({ base, value: current, select, panels, activation, orientation, variant, size, fill }),
    [base, current, select, panels, activation, orientation, variant, size, fill],
  );
  return (
    <TabsCtx value={ctx}>
      <div className={className}>{children}</div>
    </TabsCtx>
  );
}

/** The strip of tabs. Name it with `label` (or `labelledBy`). */
export function TabList({
  label,
  labelledBy,
  className = "",
  children,
  ...rest
}: {
  label?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "role" | "aria-label" | "aria-labelledby">) {
  const { orientation, variant, size, fill, activation } = useTabs("TabList");

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)'));
    const here = tabs.findIndex((tab) => tab === (event.target as HTMLElement).closest('[role="tab"]'));
    if (here === -1 || tabs.length === 0) return;
    const rtl = orientation === "horizontal" && getComputedStyle(list).direction === "rtl";
    const forward = orientation === "vertical" ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = orientation === "vertical" ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    let next = -1;
    if (event.key === forward) next = (here + 1) % tabs.length;
    else if (event.key === backward) next = (here - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === -1) return;
    event.preventDefault();
    tabs[next].focus();
    if (activation === "auto") tabs[next].click();
  };

  return (
    <div
      {...rest}
      role="tablist"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-orientation={orientation}
      className={tabsClass({ variant, size, fill, className })}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/** One tab. Only the selected tab is in the Tab order (a roving tabindex); the arrow keys reach the others. */
export function Tab({
  value,
  disabled,
  className = "",
  children,
  ...rest
}: {
  value: string;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "role" | "type" | "children" | "onClick">) {
  const ctx = useTabs("Tab");
  const selected = ctx.value === value;
  return (
    <button
      {...rest}
      type="button"
      role="tab"
      id={tabId(ctx.base, value)}
      aria-selected={selected}
      aria-controls={ctx.panels ? panelId(ctx.base, value) : undefined}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      className={`${tabClass} ${className}`.trim()}
      onClick={() => ctx.select(value)}
    >
      {children}
    </button>
  );
}

/**
 * The panel a tab controls. Hidden panels stay in the DOM (`keepMounted`, the default) unless the content is heavy or must reset;
 * the visible one takes focus from the tab with Tab, as the APG pattern asks, unless it holds focusable content of its own (`focusable={false}`).
 */
export function TabPanel({
  value,
  keepMounted = true,
  focusable = true,
  className = "",
  children,
  ...rest
}: {
  value: string;
  keepMounted?: boolean;
  focusable?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "role" | "id" | "aria-labelledby" | "hidden">) {
  const ctx = useTabs("TabPanel");
  const selected = ctx.value === value;
  return (
    <div
      {...rest}
      role="tabpanel"
      id={panelId(ctx.base, value)}
      aria-labelledby={tabId(ctx.base, value)}
      hidden={!selected}
      tabIndex={focusable && selected ? 0 : undefined}
      className={`lm-tabpanel ${className}`.trim()}
    >
      {keepMounted || selected ? children : null}
    </div>
  );
}
