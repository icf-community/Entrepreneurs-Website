import { useEffect, useEffectEvent, useLayoutEffect, type RefObject } from "react";
import { placeFloating, type Placement } from "./floating";

// ════════════════════════════════════════════════════════════════════
// Foundry · anchored surfaces (Lumen)
//
// The two hooks every floating thing shares: where it sits (and that it sits in
// the top layer), and how it is dismissed. Tooltip, Popover and Menu are thin
// layers over these.
//
// The native Popover API (popover="manual", showPopover()) is used for one
// reason only: it puts the surface in the top layer, above every stacking
// context and past any ancestor's overflow, including above an open modal
// <dialog> it lives in. Opening, closing, Escape, outside-click and focus are
// all handled here instead of by popover="auto", because the browser's light
// dismiss and a React-owned `aria-expanded` disagree about a click on the
// trigger (it closes on pointerdown, then the click handler opens it again).
// Where the API is missing the surface is a fixed-position element with a
// z-index, which is good enough.
// ════════════════════════════════════════════════════════════════════

function isShowing(el: HTMLElement): boolean {
  try {
    return el.matches(":popover-open");
  } catch {
    return false; // a browser without the pseudo-class has no top layer to be in
  }
}

export function showSurface(el: HTMLElement) {
  if (typeof el.showPopover !== "function" || isShowing(el)) return;
  try {
    el.showPopover();
  } catch {
    // Not connected yet, or already showing: nothing to do.
  }
}

export function hideSurface(el: HTMLElement) {
  if (typeof el.hidePopover !== "function" || !isShowing(el)) return;
  try {
    el.hidePopover();
  } catch {
    // Already hidden.
  }
}

/**
 * Show `surface` in the top layer and keep it beside its anchor while `open`.
 * It is measured at its natural width (a surface already pushed against the
 * right edge would otherwise measure narrow), placed by `placeFloating`, and
 * re-placed on resize, on scroll anywhere on the page and when its own size
 * changes. Writes `left`, `top` and `data-side` straight to the element: this
 * runs in a layout effect so there is never a frame in the wrong place, and
 * React does not own those three properties.
 */
export function useFloatingSurface({
  open,
  anchorRef,
  surfaceRef,
  placement,
  gap = 8,
  pad = 8,
  anchorOf,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLElement | null>;
  placement: Placement;
  gap?: number;
  pad?: number;
  /** Pick the element to measure from the anchor ref (a Tooltip's wrapper has no box of its own). Must be a stable function. */
  anchorOf?: (root: HTMLElement) => Element | null;
}) {
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!open || !surface) return;
    showSurface(surface);

    const place = () => {
      const root = anchorRef.current;
      const anchor = root ? (anchorOf ? anchorOf(root) : root) : null;
      if (!anchor) return;
      surface.style.left = "0px";
      surface.style.top = "0px";
      const size = surface.getBoundingClientRect();
      const { left, top, side } = placeFloating({
        anchor: anchor.getBoundingClientRect(),
        size: { width: size.width, height: size.height },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        placement,
        gap,
        pad,
      });
      surface.style.left = `${Math.round(left)}px`;
      surface.style.top = `${Math.round(top)}px`;
      surface.dataset.side = side;
    };
    place();

    let frame = 0;
    const later = (event?: Event) => {
      // Scrolling inside the surface (a long menu) does not move its anchor.
      if (event?.target instanceof Node && surface.contains(event.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener("resize", later);
    window.addEventListener("scroll", later, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => later());
    observer?.observe(surface);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", later);
      window.removeEventListener("scroll", later, true);
      observer?.disconnect();
      hideSurface(surface);
    };
  }, [open, anchorRef, surfaceRef, placement, gap, pad, anchorOf]);
}

/**
 * Escape and a press outside dismiss an open surface. Both listen on the
 * document in the capture phase, so the surface answers first: Escape inside a
 * modal dialog closes the popover and leaves the dialog open (a second Escape
 * closes the dialog). Escape is only taken while the surface is open.
 */
export function useDismiss({
  open,
  contains,
  onDismiss,
}: {
  open: boolean;
  /** Is this node part of the surface or its trigger? A press inside is not "outside". */
  contains: (node: Node) => boolean;
  onDismiss: (reason: "outside" | "escape") => void;
}) {
  const inside = useEffectEvent(contains);
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !inside(event.target)) dismiss("outside");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss("escape");
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
}

// ── Tooltips: one at a time, and no second wait ─────────────────────────────────────────────────────────────────
// Kept out of the component so the bookkeeping is not a component mutating module state. It holds each open tooltip's
// state setter (stable across renders), so identity checks are safe.
let activeTip: ((open: boolean) => void) | null = null;
let lastTipClosedAt = 0;
const WARM_MS = 500;

export const tips = {
  /** A tooltip opened: any other one closes. */
  opened(setOpen: (open: boolean) => void) {
    if (activeTip && activeTip !== setOpen) activeTip(false);
    activeTip = setOpen;
  },
  /** A tooltip closed (or was unmounted). */
  closed(setOpen: (open: boolean) => void) {
    if (activeTip !== setOpen) return;
    activeTip = null;
    lastTipClosedAt = Date.now();
  },
  /** Moving from one tooltip to the next should not make you wait the full delay again. */
  warm(): boolean {
    return activeTip !== null || Date.now() - lastTipClosedAt < WARM_MS;
  },
};
