"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";

const MAX_MESSAGE = 600;

export function Composer({
  draft, setDraft, disabled, sending, placeholder, starters, onSend, showTemporary, temporary, setTemporary,
}: {
  draft: string;
  setDraft: (v: string) => void;
  disabled: boolean;
  sending: boolean;
  placeholder: string;
  starters: string[];
  onSend: () => void;
  showTemporary: boolean;
  temporary: boolean;
  setTemporary: (v: boolean) => void;
}) {
  const composing = useRef(false);
  const canSend = draft.trim().length > 0 && draft.length <= MAX_MESSAGE && !disabled;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSend) onSend(); }}
      className="rounded-2xl border border-border bg-bg-card p-4"
    >
      {starters.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDraft(s)}
              className="cursor-pointer rounded-lg border border-border-strong bg-tint-2 px-3 py-1.5 text-small text-text-secondary hover:border-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <label htmlFor="ai-composer" className="sr-only">Your search</label>
      <textarea
        id="ai-composer"
        rows={3}
        maxLength={MAX_MESSAGE}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter is a newline; never mid-composition (IME).
          if (e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        className="w-full resize-none rounded-lg border border-border bg-tint-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-small text-text-muted">
          <span>{draft.length}/{MAX_MESSAGE}</span>
          {showTemporary && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
              Temporary search (not used to understand later searches)
            </label>
          )}
        </div>
        <Button type="submit" size="sm" loading={sending} disabled={!canSend}>
          Search
        </Button>
      </div>
    </form>
  );
}
