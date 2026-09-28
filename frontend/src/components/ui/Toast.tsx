"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Toasts (launch programme C3)
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
// ════════════════════════════════════════════════════════════════════

type Tone = "error" | "success" | "info";
type Toast = { id: number; message: string; tone: Tone };
type ToastFn = (message: string, tone?: Tone) => void;

const ToastContext = createContext<ToastFn | null>(null);

const VISIBLE_MS = 5000;
const MAX = 3;

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
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        <div role="alert" className="flex w-full flex-col items-center gap-2">
          {errors.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>
        <div role="status" className="flex w-full flex-col items-center gap-2">
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

  const tone =
    toast.tone === "error"
      ? "border-[#ff4d4d]/50 text-[#ffb3b3]"
      : "border-border-strong text-text-primary";

  return (
    <div
      className={`pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-xl border bg-bg-card px-4 py-3 text-[0.85rem] shadow-2xl ${tone}`}
    >
      <p className="flex-1 leading-relaxed">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 cursor-pointer rounded-md border border-border-strong px-1.5 text-text-muted transition-colors hover:border-accent hover:text-text-primary"
      >
        ✕
      </button>
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
