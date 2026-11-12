"use client";

import { useEffect, useRef, type ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Dialog
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
// ════════════════════════════════════════════════════════════════════

export function Dialog({
  onClose,
  label,
  className = "",
  containerClassName = "flex items-center justify-center px-4 py-8 overflow-y-auto overscroll-contain",
  children,
}: {
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  /** Classes for the panel itself — width, radius, padding. */
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
      // background; all three are reset so the element is just a
      // transparent full-viewport layer holding the container below.
      className="fixed inset-0 m-0 p-0 w-full max-w-none h-full max-h-none bg-transparent text-text-primary backdrop:bg-black/60 backdrop:backdrop-blur-sm"
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
        <div className={`anim-dialog ${className}`} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </dialog>
  );
}
