import type { ReactNode } from "react";
import { Notice } from "@/components/ui/Notice";

// Both banners appear as the result of a submit, so they're announced.
// Errors use role="alert" (assertive — it interrupts, which is what you
// want when the thing you just tried failed); success uses role="status"
// (polite — it waits for a pause).
//
// Both are a Notice (components/ui/Notice) in the danger or success tone: the
// hairline, the wash and the drawn icon carry the tone, the words stay in ink.
// The role sits on the Notice itself and nothing else is added inside it, so a
// screen reader announces exactly `children`.

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <Notice role="alert" tone="danger">
      {children}
    </Notice>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <Notice role="status" tone="success">
      {children}
    </Notice>
  );
}
