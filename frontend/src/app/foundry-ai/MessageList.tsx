"use client";

import { Button } from "@/components/ui/Button";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";
import type { AiMessage } from "@/lib/ai/types";

// The conversation as a plain transcript, no bubbles: a small ring for who spoke (the member, or Foundry's
// sparks), the words, and for the member's own lines a quiet "Forget". Hairlines between turns.
export function MessageList({
  messages, onForget,
}: {
  messages: AiMessage[];
  onForget: (id: string) => void;
}) {
  return (
    <ol className="divide-y divide-border-subtle" aria-label="Conversation">
      {messages.map((m) => (
        <li
          key={m.id}
          className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 py-3 text-body ${m.role === "member" ? "text-text-primary" : "text-text-secondary"}`}
        >
          <Disc size="sm">
            <Icon name={m.role === "member" ? "user" : "foundry-ai"} size={16} />
          </Disc>
          <span className="min-w-0 pt-px">
            <span className="block text-caption text-text-muted">{m.role === "member" ? "You" : "Foundry"}</span>
            <span className="block whitespace-pre-wrap">{m.body}</span>
          </span>
          {m.role === "member" && (
            <Button
              variant="quiet"
              size="sm"
              type="button"
              onClick={() => onForget(m.id)}
              aria-label="Forget this message and any criteria it added"
            >
              Forget
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}
