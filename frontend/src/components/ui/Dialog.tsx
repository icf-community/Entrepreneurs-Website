"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/design-system/icons/Icon";
import { closeDialog } from "./dialogCloser";

// ════════════════════════════════════════════════════════════════════
// Foundry · Dialog (Lumen)
//
// Built on the native <dialog> element opened with showModal(), which
// hands us four things the two hand-rolled modals it replaces never
// had: focus is moved into the dialog, Tab is trapped inside it, focus
// returns to the trigger on close, and everything behind it goes inert
// (so a screen reader can't wander into the page underneath).
//
// The previous implementations were <div role="dialog" aria-modal>,
// which *claims* all of the above to assistive tech without doing any
// of it.
//
// Mounting the component opens it — both call sites already render it
// conditionally — so there is no `open` prop to keep in sync.
//
// The look is in src/design-system/overlays.css (.lm-dialog): a raised
// panel (18 px, the one overlay shadow, a hairline of warm light along its
// top edge) over a night wash with a touch of warm light from above. Pass
// only layout in `className` (width, padding, overflow); the surface, the
// border, the radius and the shadow are the Dialog's. A utility passed here
// still wins over them, which is how a bottom sheet on a phone can ask for
// `rounded-t-2xl`.
//
// A dialog interrupts and traps focus. Reach for it when the task needs
// both (a confirmation, a short form that must be finished or abandoned).
// If it needs neither, use a Popover or a disclosure instead.
// ════════════════════════════════════════════════════════════════════

export function Dialog({
  onClose,
  label,
  tone = "default",
  className = "",
  containerClassName = "flex items-center justify-center px-4 py-8 overflow-y-auto overscroll-contain",
  children,
}: {
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  /** `danger` draws the panel's edge and its top light in the danger tone (a removal, a destructive confirmation). */
  tone?: "default" | "danger";
  /** Classes for the panel itself — width, padding, overflow. */
  className?: string;
  /** Classes for the full-viewport area around the panel, which controls
   *  alignment and which element scrolls. */
  containerClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Guarded because React 19 StrictMode runs effects twice in dev, and
    // showModal() on an already-open dialog throws InvalidStateError.
    if (!dialog.open) dialog.showModal();

    // Fires for Escape (via `cancel`) and for any programmatic close.
    // Replaces the hand-written keydown listener both callers had.
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);

    // showModal() blocks interaction but not scrolling of the page
    // behind, so the scroll lock stays.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      dialog.removeEventListener("close", handleClose);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      // The UA gives <dialog> its own size, centring margins and a
      // background; .lm-dialog resets all three so the element is just a
      // transparent full-viewport layer holding the container below.
      className="lm-dialog"
    >
      {/* Clicking outside the panel closes. The panel stops propagation
          rather than the container testing event.target, so a drag that
          starts inside the panel and ends outside doesn't dismiss it.
          role="presentation": this is a click-to-dismiss backdrop, not a
          control — Escape is already handled natively by <dialog> above
          (the `close` listener), so there is no keyboard interaction to
          add here. */}
      <div
        role="presentation"
        className={`w-full h-full ${containerClassName}`}
        onClick={() => ref.current?.close()}
      >
        <div
          className={`anim-dialog lm-dialog__panel ${className}`}
          data-tone={tone === "danger" ? "danger" : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </dialog>
  );
}

/**
 * A dialog's close control: a round ring with the close glyph, named "Close".
 * It closes the dialog it is inside (through the element, so the browser
 * restores focus to whatever opened it), which also makes it the close
 * control for a Sheet. Place it top right of the panel.
 */
export function DialogClose({
  label = "Close",
  disabled = false,
  className = "",
}: {
  /** The accessible name. The specs look for "Close". */
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" onClick={closeDialog} aria-label={label} disabled={disabled} className={`lm-iconbtn ${className}`}>
      <Icon name="close" size={18} />
    </button>
  );
}
