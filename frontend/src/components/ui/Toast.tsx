"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";

// ════════════════════════════════════════════════════════════════════
// Foundry · Toasts (launch programme C3; drawn in Lumen)
//
// For outcomes that have nowhere else to appear: an optimistic toggle that
// rolled back, a background action that failed, a confirmation after a
// dialog closed. Anything with a form or dialog still open shows its error
// inline instead; a toast is for when the UI would otherwise go silent.
//
// Two live regions, mounted once and always present so screen readers
// register them before anything is announced: errors are role="alert"
// (assertive), everything else role="status" (polite). Copy is one short
// sentence, per the owner's "one sentence and a link" rule.
//
// Drawn as a pill: the tone is a drawn glyph and a hairline in the tone's
// light (danger, success, or the cold info light), and a hairline along the
// bottom edge runs out as the five seconds do. The look is in
// src/design-system/overlays.css (.lm-toast).
// ════════════════════════════════════════════════════════════════════

type Tone = "error" | "success" | "info";
type Toast = { id: number; message: string; tone: Tone };
type ToastFn = (message: string, tone?: Tone) => void;

const ToastContext = createContext<ToastFn | null>(null);

const VISIBLE_MS = 5000;
const MAX = 3;

const GLYPH: Record<Tone, IconName> = { error: "error", success: "success", info: "info" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>((message, tone = "info") => {
    const id = nextId.current++;
    // A repeat of the same message replaces the old one rather than stacking.
    setToasts((prev) => [...prev.filter((t) => t.message !== message), { id, message, tone }].slice(-MAX));
  }, []);

  const errors = toasts.filter((t) => t.tone === "error");
  const others = toasts.filter((t) => t.tone !== "error");

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="lm-toasts">
        <div role="alert" className="lm-toasts__region">
          {errors.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>
        <div role="status" className="lm-toasts__region">
          {others.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return <ToastView message={toast.message} tone={toast.tone} onDismiss={() => onDismiss(toast.id)} timed />;
}

/**
 * One toast, drawn. The provider uses it for every live toast; it is also what the style guide shows at rest
 * (leave `onDismiss` out for a toast with no control and `timed` off for one whose hairline does not run).
 */
export function ToastView({
  message,
  tone = "info",
  onDismiss,
  timed = false,
}: {
  message: string;
  tone?: Tone;
  onDismiss?: () => void;
  /** Draw the hairline that runs out over the toast's five seconds. The provider's own timer is what dismisses it. */
  timed?: boolean;
}) {
  return (
    <div className="lm-toast" data-tone={tone}>
      <span className="lm-toast__glyph" aria-hidden="true">
        <Icon name={GLYPH[tone]} size={20} />
      </span>
      <p className="lm-toast__text">{message}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="lm-toast__x">
          <Icon name="close" size={16} />
        </button>
      ) : null}
      {timed ? <span className="lm-toast__timer" aria-hidden="true" style={{ animationDuration: `${VISIBLE_MS}ms` }} /> : null}
    </div>
  );
}

/**
 * Show a toast. Outside a provider (a unit test, a stray render) it falls
 * back to the console rather than throwing, so a missing toast never takes
 * a page down.
 */
export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  return ctx ?? ((message: string) => console.warn("toast (no provider):", message));
}
