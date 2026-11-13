"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { DialogClose } from "./Dialog";

// ════════════════════════════════════════════════════════════════════
// Foundry · Sheet (Lumen)
//
// A drawer from the left or right edge: the mobile navigation, a panel of
// filters. It is a Dialog in a different shape and it works the same way: a
// native <dialog> opened with showModal(), so it is modal with a real focus
// trap, Escape closes it, focus returns to whatever opened it, and the page
// behind is inert. There is no `role="dialog"` div anywhere (the e2e suite
// forbids them): a hand-rolled one claims all of this and provides none of it.
//
// Like Dialog, mounting it opens it. Render it conditionally:
//
//   {open && (
//     <Sheet label="Filters" title="Filters" side="right" onClose={() => setOpen(false)}>
//       …
//     </Sheet>
//   )}
//
// Do not keep a closed Sheet in the DOM: the specs count `dialog` elements, and
// the content of a Sheet that matters (the navigation) already lives in the page
// at the sizes where the Sheet is not used.
//
// With a `title` it draws a header (the title and the round Close ring, named
// "Close"). Without one it draws no header, and its content brings its own
// <DialogClose />. Clicking outside, Escape and the Close ring all close it.
//
// A sheet interrupts like any modal. If the task needs neither interruption nor
// protected focus, use a Popover or a disclosure instead.
// ════════════════════════════════════════════════════════════════════

export function Sheet({
  onClose,
  label,
  side = "right",
  title,
  closeLabel = "Close",
  className = "",
  children,
}: {
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  side?: "left" | "right";
  /** A visible title: draws the header with the Close ring. */
  title?: ReactNode;
  /** The Close ring's accessible name. */
  closeLabel?: string;
  /** Classes for the panel (width, padding). */
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Guarded because React 19 StrictMode runs effects twice in dev, and
    // showModal() on an already-open dialog throws InvalidStateError.
    if (!dialog.open) dialog.showModal();

    // Fires for Escape (via `cancel`), for the Close ring and for any programmatic close.
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);

    // showModal() blocks interaction but not scrolling of the page behind.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      dialog.removeEventListener("close", handleClose);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <dialog ref={ref} aria-label={label} className="lm-dialog lm-sheet" data-side={side}>
      {/* Clicking outside the panel closes; the panel stops propagation, so a drag that starts inside and ends outside does not.
          role="presentation": a click-to-dismiss backdrop, not a control (Escape is handled natively by <dialog>). */}
      <div role="presentation" className="lm-sheet__layer" onClick={() => ref.current?.close()}>
        <div className={`lm-sheet__panel ${className}`} onClick={(e) => e.stopPropagation()}>
          {title ? (
            <header className="lm-sheet__head">
              <h2 className="lm-sheet__title">{title}</h2>
              <DialogClose label={closeLabel} />
            </header>
          ) : null}
          {children}
        </div>
      </div>
    </dialog>
  );
}
