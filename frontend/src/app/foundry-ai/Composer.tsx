"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Chip } from "@/components/ui/Chip";
import { Panel } from "@/components/ui/Panel";
import { Textarea } from "@/components/ui/Textarea";

const MAX_MESSAGE = 600;

// The one calm field the whole screen leans on: starters above it (a chip fills the draft, never sends it),
// the counter and the temporary-search choice under it, and the one lit action. `#ai-composer` and its
// "Your search" name are what the specs and a screen reader find it by.
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
    <Panel
      as="form"
      onSubmit={(e) => { e.preventDefault(); if (canSend) onSend(); }}
      className="p-4 sm:p-5"
    >
      {starters.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {starters.map((s) => (
            <Chip key={s} size="sm" className="whitespace-normal text-left" onClick={() => setDraft(s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}
      <label htmlFor="ai-composer" className="sr-only">Your search</label>
      <Textarea
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
        className="resize-none"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-small text-text-muted">
          <span className="data">{draft.length}/{MAX_MESSAGE}</span>
          {showTemporary && (
            <Checkbox
              label="Temporary search (not used to understand later searches)"
              checked={temporary}
              onChange={(e) => setTemporary(e.target.checked)}
            />
          )}
        </div>
        <Button type="submit" size="sm" lit loading={sending} disabled={!canSend}>
          Search
        </Button>
      </div>
    </Panel>
  );
}
