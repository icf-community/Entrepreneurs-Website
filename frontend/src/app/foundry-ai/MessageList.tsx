"use client";

import type { AiMessage } from "@/lib/ai/types";

export function MessageList({
  messages, onForget,
}: {
  messages: AiMessage[];
  onForget: (id: string) => void;
}) {
  return (
    <ol className="space-y-2" aria-label="Conversation">
      {messages.map((m) => (
        <li key={m.id} className={`flex items-start gap-2 text-[0.85rem] ${m.role === "member" ? "text-text-primary" : "text-text-secondary"}`}>
          <span className="shrink-0 text-[0.65rem] uppercase tracking-wider text-text-muted">{m.role === "member" ? "You" : "Foundry"}</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{m.body}</span>
          {m.role === "member" && (
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-md border border-border-strong px-2 py-0.5 text-[0.65rem] text-text-muted hover:border-accent"
              onClick={() => onForget(m.id)}
              aria-label="Forget this message and any criteria it added"
            >
              Forget
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
