"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ConversationListItem } from "@/lib/ai/types";

export function ConversationSidebar({
  conversations, conversationId, running, onSelect, onDeleteAll,
}: {
  conversations: ConversationListItem[] | null;
  conversationId: string | null;
  running: boolean;
  onSelect: (id: string | null) => void;
  onDeleteAll: () => void;
}) {
  return (
    <aside className="order-2 lg:order-1">
      <details className="rounded-2xl border border-border bg-bg-card" open>
        <summary className="cursor-pointer px-4 py-3 text-[0.8rem] text-text-primary lg:hidden">Recent searches</summary>
        <div className="space-y-2 px-4 pb-4 lg:pt-4">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => onSelect(null)} disabled={running}>
            New search
          </Button>
          {conversations === null ? (
            <Skeleton className="h-16 w-full" />
          ) : conversations.length === 0 ? (
            <p className="text-[0.75rem] text-text-muted">No recent searches.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    aria-current={c.id === conversationId ? "true" : undefined}
                    className={`w-full cursor-pointer truncate rounded-lg border px-3 py-2 text-left text-[0.8rem] ${
                      c.id === conversationId ? "border-accent text-text-primary" : "border-border-strong text-text-secondary hover:border-accent"
                    }`}
                  >
                    {c.title || "Untitled search"}
                    {c.temporary && <span className="text-text-muted"> · temporary</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-2 text-[0.7rem] text-text-muted">
            Chats are kept for 7 days. <Link href="/ai-notice" className="underline">How AI search works</Link>
          </p>
          <Button variant="dangerGhost" size="sm" className="w-full" onClick={onDeleteAll}>
            Delete all AI history
          </Button>
        </div>
      </details>
    </aside>
  );
}
