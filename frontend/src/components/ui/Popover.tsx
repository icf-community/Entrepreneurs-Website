"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";
import type { ButtonSize, ButtonVariant } from "./Button";
import { useDismiss, useFloatingSurface } from "./anchored";
import type { Placement } from "./floating";

// ════════════════════════════════════════════════════════════════════
// Foundry · Popover and Menu (Lumen)
//
// A button and an anchored panel, for the things a page should not carry open:
// a few links, a short form, a list of commands. Neither interrupts and
// neither traps focus, which is the reason to prefer them to a Dialog.
//
//   Popover  a disclosure. The button has aria-expanded and aria-controls; the
//            panel holds anything. Focus stays on the button when it opens, and
//            the next Tab goes into the panel (it follows the button in the DOM).
//            It does not claim to be an ARIA menu.
//   Menu     a list of commands, role="menu", with arrow-key navigation
//            (Up, Down, Home, End, type-ahead), Enter or Space to choose, and
//            Tab to leave. The button opens it from the keyboard with Enter,
//            Space, Down (first item) or Up (last).
//
// Both: Escape closes and gives focus back to the button; a press outside, or
// focus moving outside, closes without taking focus; choosing a menu item closes
// and gives focus back. The panel is a native popover="manual" element, so it is
// in the top layer (never clipped, above everything, including the modal
// dialog it may sit in) and is placed beside the button by a little JavaScript
// that flips it near the edge of the screen (anchored.ts, floating.ts). It is
// always in the DOM, hidden by display, so the words in it stay findable.
//
// The button is drawn here: any Button variant and size, an optional leading
// icon, a caret; or, with `iconOnly`, the round ring icon button (the label then
// names it). The look of everything is src/design-system/overlays.css.
// ════════════════════════════════════════════════════════════════════

type Kind = "popover" | "menu";
type CloseOptions = { restoreFocus?: boolean };
export type PopoverApi = { close: (options?: CloseOptions) => void };

const PopoverContext = createContext<PopoverApi | null>(null);

type Props = {
  /** The button's text. With `iconOnly` it is the button's accessible name instead. */
  label: string;
  icon?: IconName;
  /** A round ring icon button (more, filters, settings) rather than a labelled pill. */
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A chevron after the label. */
  caret?: boolean;
  placement?: Placement;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Classes for the button. */
  className?: string;
  /** Classes for the panel (width, padding). */
  panelClassName?: string;
  /** Gives a Popover's panel a name (role="group"); a Menu is named by its button. */
  panelLabel?: string;
  /** The panel: anything for a Popover, MenuItems for a Menu. A function receives `close`. */
  children: ReactNode | ((api: PopoverApi) => ReactNode);
};

// ── Menu keyboard: pure helpers, so the component stays small ─────────────────────────────────────────────────────

function menuItems(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled):not([aria-disabled="true"])'));
}

/** Arrow, Home and End: which item is next (the list wraps). */
function stepTarget(items: HTMLElement[], current: number, key: string): HTMLElement | undefined {
  const last = items.length - 1;
  if (key === "ArrowDown") return items[current < 0 || current === last ? 0 : current + 1];
  if (key === "ArrowUp") return items[current <= 0 ? last : current - 1];
  if (key === "Home") return items[0];
  if (key === "End") return items[last];
  return undefined;
}

type Typeahead = { text: string; timer: ReturnType<typeof setTimeout> | undefined };

/** A letter jumps to the next item that starts with what has been typed; the same letter again steps through the items that start with it. */
function typeaheadTarget(items: HTMLElement[], current: number, key: string, buffer: Typeahead): HTMLElement | undefined {
  clearTimeout(buffer.timer);
  buffer.text += key.toLowerCase();
  buffer.timer = setTimeout(() => {
    buffer.text = "";
  }, 600);
  const query = /^(.)\1*$/.test(buffer.text) ? buffer.text[0] : buffer.text;
  const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
  return ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(query));
}

/** The panel's keydown handler for a Menu (a Popover has none). Tab closes the menu and lets focus move on by itself. */
function useMenuKeys(kind: Kind, panelRef: RefObject<HTMLDivElement | null>, close: () => void) {
  const typed = useRef<Typeahead>({ text: "", timer: undefined });
  return function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (kind !== "menu") return;
    if (event.key === "Tab") {
      close();
      return;
    }
    const items = menuItems(panelRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const isCharacter = event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
    const next = isCharacter ? typeaheadTarget(items, current, event.key, typed.current) : stepTarget(items, current, event.key);
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
  };
}

// ── The component ───────────────────────────────────────────────────────────────────────────────────────────────

/** Open, closed, and how to close (optionally handing focus back to the button). */
function usePopoverState(defaultOpen: boolean, onOpenChange: ((open: boolean) => void) | undefined) {
  const [open, setOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const change = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(
    (options?: CloseOptions) => {
      change(false);
      if (options?.restoreFocus) triggerRef.current?.focus();
    },
    [change],
  );
  const api = useMemo<PopoverApi>(() => ({ close }), [close]);
  return { open, change, close, api, triggerRef };
}

/**
 * What the button does beyond toggling. A menu hands focus to an item as it opens (with a click or Enter or Down: the first;
 * with Up: the last), and Down or Up on the button of an open menu moves into it. Declared after useFloatingSurface, so the
 * panel is showing by the time focus goes in.
 */
function useTriggerBehaviour(kind: Kind, open: boolean, change: (open: boolean) => void, panelRef: RefObject<HTMLDivElement | null>) {
  const focusOnOpen = useRef<"first" | "last" | null>(null);

  useLayoutEffect(() => {
    if (!open || kind !== "menu") return;
    const items = menuItems(panelRef.current);
    const target = focusOnOpen.current === "last" ? items[items.length - 1] : items[0];
    focusOnOpen.current = null;
    target?.focus({ preventScroll: true });
  }, [open, kind, panelRef]);

  function onClick() {
    if (!open && kind === "menu") focusOnOpen.current = "first";
    change(!open);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (kind !== "menu" || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    const last = event.key === "ArrowUp";
    if (!open) {
      focusOnOpen.current = last ? "last" : "first";
      change(true);
      return;
    }
    const items = menuItems(panelRef.current);
    (last ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });
  }
  return { onClick, onKeyDown };
}

type Look = Pick<Props, "label" | "icon" | "iconOnly" | "variant" | "size" | "caret" | "className">;

/** The button: a Button-shaped pill, or the round ring icon button. */
function Trigger({
  look: { label, icon, iconOnly = false, variant = "ghost", size = "sm", caret = true, className = "" },
  kind,
  id,
  panelId,
  open,
  buttonRef,
  ...handlers
}: {
  look: Look;
  kind: Kind;
  id: string;
  panelId: string;
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onBlur: (event: FocusEvent) => void;
}) {
  return (
    <button
      {...handlers}
      ref={buttonRef}
      id={id}
      type="button"
      className={`${iconOnly ? "lm-iconbtn" : "lm-btn"} lm-pop__trigger ${className}`}
      data-variant={iconOnly ? undefined : variant}
      data-size={iconOnly ? undefined : size}
      aria-expanded={open}
      aria-controls={panelId}
      aria-haspopup={kind === "menu" ? "menu" : undefined}
      aria-label={iconOnly ? label : undefined}
    >
      {iconOnly ? (
        <Icon name={icon ?? "more"} size={20} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} /> : null}
          {label}
          {caret ? <Icon name="chevron-down" size={16} className="lm-pop__caret" /> : null}
        </>
      )}
    </button>
  );
}

/** A menu is named by its button; a popover by `panelLabel`, when it has one. */
function panelAttributes(kind: Kind, triggerId: string, panelLabel: string | undefined) {
  if (kind === "menu") return { role: "menu" as const, "aria-labelledby": triggerId };
  return panelLabel ? { role: "group" as const, "aria-label": panelLabel } : {};
}

function PopoverBase({
  kind,
  placement = "bottom-start",
  defaultOpen = false,
  onOpenChange,
  panelClassName = "",
  panelLabel,
  children,
  ...look
}: Props & { kind: Kind }) {
  const id = useId();
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;
  const panelRef = useRef<HTMLDivElement>(null);
  const { open, change, close, api, triggerRef } = usePopoverState(defaultOpen, onOpenChange);

  useFloatingSurface({ open, anchorRef: triggerRef, surfaceRef: panelRef, placement });
  useDismiss({
    open,
    contains: (node) => !!(triggerRef.current?.contains(node) || panelRef.current?.contains(node)),
    onDismiss: (reason) => close({ restoreFocus: reason === "escape" }),
  });
  const onPanelKeyDown = useMenuKeys(kind, panelRef, close);
  const trigger = useTriggerBehaviour(kind, open, change, panelRef);

  // Focus moving somewhere else (Tab past the panel, a click into another field) closes it. Focus going to nothing
  // (the window lost focus) does not: it will come back to where it was.
  function onBlur(event: FocusEvent) {
    const next = event.relatedTarget;
    if (!open || !(next instanceof Node)) return;
    if (triggerRef.current?.contains(next) || panelRef.current?.contains(next)) return;
    change(false);
  }

  return (
    <>
      <Trigger
        look={look}
        kind={kind}
        id={triggerId}
        panelId={panelId}
        open={open}
        buttonRef={triggerRef}
        onClick={trigger.onClick}
        onKeyDown={trigger.onKeyDown}
        onBlur={onBlur}
      />
      <div
        {...panelAttributes(kind, triggerId, panelLabel)}
        ref={panelRef}
        id={panelId}
        popover="manual"
        data-open={open || undefined}
        data-kind={kind}
        className={`lm-pop ${panelClassName}`}
        onKeyDown={onPanelKeyDown}
        onBlur={onBlur}
      >
        <PopoverContext.Provider value={api}>{typeof children === "function" ? children(api) : children}</PopoverContext.Provider>
      </div>
    </>
  );
}

export function Popover(props: Props) {
  return <PopoverBase kind="popover" {...props} />;
}

export function Menu(props: Props) {
  return <PopoverBase kind="menu" {...props} />;
}

/**
 * One command in a Menu. With `href` it is a link (next/link for an internal path); otherwise a button, and `onSelect` runs when it
 * is chosen. Either way choosing it closes the menu and returns focus to the menu's button. `tone="danger"` is for a removal.
 */
export function MenuItem({
  href,
  onSelect,
  icon,
  tone = "default",
  disabled = false,
  className = "",
  children,
}: {
  href?: string;
  onSelect?: () => void;
  icon?: IconName;
  tone?: "default" | "danger";
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const api = useContext(PopoverContext);
  const body = (
    <>
      {icon ? <Icon name={icon} size={18} className="lm-pop__item-icon" /> : null}
      <span className="lm-pop__item-label">{children}</span>
    </>
  );
  const common = {
    role: "menuitem" as const,
    tabIndex: -1,
    className: `lm-pop__item ${className}`,
    "data-tone": tone === "danger" ? "danger" : undefined,
  };

  if (href) {
    const linkProps = {
      ...common,
      "aria-disabled": disabled || undefined,
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onSelect?.();
        api?.close({ restoreFocus: true });
      },
      // A link answers Enter by itself; a menu item must answer Space too.
      onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => {
        if (event.key === " ") {
          event.preventDefault();
          event.currentTarget.click();
        }
      },
    };
    const internal = href.startsWith("/") && !href.startsWith("//");
    return internal ? (
      <Link href={href} {...linkProps}>
        {body}
      </Link>
    ) : (
      <a href={href} {...linkProps}>
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      {...common}
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        api?.close({ restoreFocus: true });
      }}
    >
      {body}
    </button>
  );
}

/** A hairline between groups of commands. */
export function MenuSeparator() {
  return <hr className="lm-pop__sep" />;
}
