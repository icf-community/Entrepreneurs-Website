"use client";

import { cloneElement, useEffect, useEffectEvent, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/design-system/icons/Icon";
import { tips, useDismiss, useFloatingSurface } from "./anchored";
import type { Placement } from "./floating";

// ════════════════════════════════════════════════════════════════════
// Foundry · Tooltip (Lumen)
//
// A sentence that explains a control or a value, held out of the row it would
// otherwise crowd. It opens on hover (after 350 ms, so a pointer passing over
// does not make things flicker, and with no second wait when you move from one
// tooltip to the next), on keyboard focus (at once), and on a tap on a touch
// screen. Escape closes it, a press elsewhere closes it, and it never keeps
// another one company.
//
//   <Tooltip content="Only people you have connected with can see this.">
//     <button type="button">Private</button>
//   </Tooltip>
//
// The trigger is the one child, and it must be something a keyboard can reach
// (a button, a link) that passes `aria-describedby` on to its element (everything
// in components/ui does). The bubble is always in the DOM and the trigger's
// aria-describedby always points at it, so a screen reader reads it with the
// control whether or not it is showing, and the words are findable on the page.
//
// The listeners are native and sit on the wrapper, which has no box of its own
// (display: contents): hover, focus and touch events from the trigger bubble up
// to it, and so do those from the bubble, which is what lets the pointer travel
// onto the bubble without it closing (WCAG 1.4.13: hoverable). It is dismissed
// with Escape without moving the pointer or the focus, and stays until you leave.
// It sits in the top layer, so no ancestor's overflow can clip it, and it flips
// to the other side near the edge of the screen (floating.ts).
//
// A tooltip is for a sentence, not for anything essential: on a touch screen it
// takes a tap to see. If people need the words to act, put them on the page.
// ════════════════════════════════════════════════════════════════════

const OPEN_DELAY = 350;
const CLOSE_DELAY = 120;

/** The trigger is the wrapper's first element: the wrapper itself has no box (display: contents). */
const triggerOf = (root: HTMLElement) => root.firstElementChild;

export function Tooltip({
  content,
  children,
  placement = "top",
  delay = OPEN_DELAY,
  className = "",
}: {
  /** The sentence. */
  content: ReactNode;
  /** The trigger: one focusable element. */
  children: ReactElement<{ "aria-describedby"?: string }>;
  placement?: Placement;
  /** Milliseconds a hover waits before the tooltip opens. Focus and touch open it at once. */
  delay?: number;
  /** For the bubble. */
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastPointer = useRef("mouse");

  useFloatingSurface({ open, anchorRef: rootRef, surfaceRef: bubbleRef, placement, anchorOf: triggerOf });
  useDismiss({
    open,
    contains: (node) => !!rootRef.current?.contains(node),
    onDismiss: () => hide(),
  });

  function show(wait: number) {
    clearTimeout(timer.current);
    const reveal = () => {
      setOpen(true);
      tips.opened(setOpen);
    };
    if (wait <= 0) reveal();
    else timer.current = setTimeout(reveal, wait);
  }
  function hide() {
    clearTimeout(timer.current);
    setOpen(false);
    tips.closed(setOpen);
  }
  function hideSoon() {
    clearTimeout(timer.current);
    timer.current = setTimeout(hide, CLOSE_DELAY);
  }

  // The wrapper's listeners. Effect Events read the latest `open` and `delay` without re-attaching anything.
  const onOver = useEffectEvent((event: PointerEvent) => {
    lastPointer.current = event.pointerType;
    // A touch screen sends a pointer-over with the tap; the click below owns it.
    if (event.pointerType !== "touch") show(tips.warm() ? 0 : delay);
  });
  const onOut = useEffectEvent((event: PointerEvent) => {
    if (event.pointerType !== "touch") hideSoon();
  });
  const onClick = useEffectEvent((event: MouseEvent) => {
    const trigger = rootRef.current ? triggerOf(rootRef.current) : null;
    if (lastPointer.current !== "touch" || !(event.target instanceof Node) || !trigger?.contains(event.target)) return;
    if (open) hide();
    else show(0);
  });
  const onFocusIn = useEffectEvent((event: FocusEvent) => {
    // Keyboard focus only: focus handed back to a button after a dialog closes should not pop a tooltip.
    if (event.target instanceof Element && event.target.matches(":focus-visible")) show(0);
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const inside = (target: EventTarget | null) => target instanceof Node && root.contains(target);
    const over = (event: PointerEvent) => {
      if (!inside(event.relatedTarget)) onOver(event);
    };
    const out = (event: PointerEvent) => {
      if (!inside(event.relatedTarget)) onOut(event);
    };
    const press = (event: PointerEvent) => {
      lastPointer.current = event.pointerType;
    };
    const focusOut = () => hide();
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    root.addEventListener("pointerdown", press);
    root.addEventListener("click", onClick);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", focusOut);
    const pending = timer;
    return () => {
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("pointerdown", press);
      root.removeEventListener("click", onClick);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", focusOut);
      // A tooltip that unmounts while open must not leave the shared registry pointing at it.
      clearTimeout(pending.current);
      tips.closed(setOpen);
    };
    // The handlers above are Effect Events, and `hide` only touches refs and a stable setter: attach once.
  }, []);

  const own = children.props["aria-describedby"];
  const trigger = cloneElement(children, { "aria-describedby": own ? `${own} ${id}` : id });

  return (
    <span ref={rootRef} className="lm-tip">
      {trigger}
      <span
        ref={bubbleRef}
        id={id}
        role="tooltip"
        popover="manual"
        data-open={open || undefined}
        className={`lm-tip__bubble ${className}`}
      >
        {content}
      </span>
    </span>
  );
}

/**
 * The small "i" that holds a sentence which would otherwise crowd a row (a label, a field, a badge's meaning).
 * 28 px drawn, 44 px to hit; `label` names the button, the children are the sentence.
 */
export function InfoTip({
  label = "More information",
  placement = "top",
  children,
}: {
  label?: string;
  placement?: Placement;
  children: ReactNode;
}) {
  return (
    <Tooltip content={children} placement={placement}>
      <button type="button" className="lm-infotip" aria-label={label}>
        <Icon name="info" size={16} />
      </button>
    </Tooltip>
  );
}
