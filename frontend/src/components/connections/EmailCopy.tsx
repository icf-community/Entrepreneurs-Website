"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/design-system/icons/Icon";
import { mailtoHref } from "@/lib/safeUrl";

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
      <div className="flex items-center gap-2">
        {/* The address is a link as well as a copy target: copy is for when the
            conversation is happening somewhere else, mailto for when it isn't. */}
        <ButtonLink
          href={mailtoHref(email)}
          variant="ghost"
          size="sm"
          leading={<Icon name="mail" size={18} />}
          className="min-w-0 flex-1 justify-start"
          title={`Email ${name} at ${email}`}
        >
          <span className="truncate">{email}</span>
        </ButtonLink>
        {/* In the row, not under it: a line that appears and goes would shift the card for two seconds. */}
        {state === "copied" && (
          <span className="shrink-0 text-small text-text-muted" aria-hidden>Copied</span>
        )}
        <button
          type="button"
          onClick={copy}
          // An icon-only control, so the accessible name has to carry the
          // whole meaning — including whose address it is, because a list
          // of cards otherwise reads as forty identical "Copy" buttons.
          aria-label={`Copy ${name}'s email address`}
          className="lm-iconbtn"
        >
          <Icon name={state === "copied" ? "check" : "copy"} size={18} />
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

      {state === "failed" && (
        <div className="flex flex-col gap-1.5">
          <span id={hintId} className="text-small text-text-muted">
            Your browser blocked the copy. Select the address and copy it yourself:
          </span>
          <Input
            ref={fallbackRef}
            compact
            readOnly
            value={email}
            aria-label={`${name}'s email address`}
            aria-describedby={hintId}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}
