"use client";

import { useEffect, useId, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · The copy-an-address control
//
// THIS IS THE INTERACTION THE WHOLE FEATURE EXISTS FOR. Everything
// else — the request, the note, the accept, the graph — is machinery
// around getting this one string into somebody's clipboard.
//
// Which is why it does not simply call navigator.clipboard and hope.
// That API needs a secure context and can be refused by permissions
// policy, and it fails by REJECTING A PROMISE — so the naive version
// looks like a working button that does nothing, on exactly the
// browsers where nobody will think to check. The failure path here
// reveals the address as selectable text and selects it, so the member
// can always get to the thing they came for.
//
// The address is also a real mailto: link, not only a copy target. Copy
// is what you want when the conversation is happening somewhere else;
// mailto is what you want when it isn't.
// ════════════════════════════════════════════════════════════════════

type State = "idle" | "copied" | "failed";

export function EmailCopy({ email, name }: { email: string; name: string }) {
  const [state, setState] = useState<State>("idle");
  const hintId = useId();
  const fallbackRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      // Both halves can throw: the property access itself is fine, but
      // writeText rejects on an insecure context or a blocked permission,
      // and in some embedded webviews `clipboard` is simply undefined.
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(email);
      setState("copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
      // Selecting it is the fallback: the member can then use their own
      // copy shortcut, which needs no permission at all.
      queueMicrotask(() => {
        fallbackRef.current?.focus();
        fallbackRef.current?.select();
      });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <a
          href={`mailto:${email}`}
          className="min-w-0 flex-1 truncate rounded-lg border border-border-strong bg-white/[0.05] px-2.5 py-1.5 text-[0.75rem] text-text-primary no-underline transition-colors hover:border-accent hover:bg-white/[0.10]"
          title={`Email ${name} at ${email}`}
        >
          {email}
        </a>
        <button
          type="button"
          onClick={copy}
          // An icon-only control, so the accessible name has to carry the
          // whole meaning — including whose address it is, because a list
          // of cards otherwise reads as forty identical "Copy" buttons.
          aria-label={`Copy ${name}'s email address`}
          className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong bg-white/[0.05] text-text-primary transition-colors hover:border-accent hover:bg-white/[0.10] cursor-pointer"
        >
          {state === "copied" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* aria-live so the confirmation reaches a screen reader too — a
          checkmark swap is invisible to one, and "did that work?" is the
          entire question this control has to answer.

          SUCCESS ONLY, deliberately. The failure case used to say nothing
          at all, which was the real gap: the catch branch pulls focus to
          the fallback input, so a screen reader announced a read-only
          textbox appearing from nowhere with no word about why. That is
          fixed by `aria-describedby` on the input rather than by a second
          live announcement — the description is read as part of the focus
          move, so it cannot be preempted by it, and the reader hears the
          explanation once instead of twice. */}
      <p aria-live="polite" className="sr-only">
        {state === "copied" ? "Email address copied" : ""}
      </p>
      {state === "copied" && (
        <span className="text-[0.7rem] text-text-muted" aria-hidden>Copied</span>
      )}

      {state === "failed" && (
        <div className="flex flex-col gap-1">
          <span id={hintId} className="text-[0.7rem] text-text-muted">
            Your browser blocked the copy. Select the address and copy it yourself:
          </span>
          <input
            ref={fallbackRef}
            readOnly
            value={email}
            aria-label={`${name}'s email address`}
            aria-describedby={hintId}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-border-strong bg-bg-secondary px-2.5 py-1.5 text-[0.75rem] text-text-primary"
          />
        </div>
      )}
    </div>
  );
}
