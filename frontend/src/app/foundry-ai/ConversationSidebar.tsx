"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/design-system/icons/Icon";
import type { ConversationListItem } from "@/lib/ai/types";

// The rail of recent searches. On a phone it is a native <details> that opens and closes under "Recent
// searches"; from lg up it is always open and the title is a plain heading (a summary there would be a
// button that collapses the rail by accident). The current search is lit and carries aria-current.
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
    <aside className="order-2 min-w-0 lg:sticky lg:top-6 lg:order-1 lg:self-start">
      <Panel>
        <details open>
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2 text-body text-text-primary lg:hidden">
            Recent searches
            <Icon name="chevron-down" size={16} className="text-text-secondary" />
          </summary>
          <div className="space-y-3 p-4 lg:pt-5">
            <h2 className="hidden font-display text-lead text-text-primary lg:block">Recent searches</h2>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="w-full"
              onClick={() => onSelect(null)}
              disabled={running}
              leading={<Icon name="plus" size={18} />}
            >
              New search
            </Button>
            {conversations === null ? (
              <Skeleton className="h-16 w-full" />
            ) : conversations.length === 0 ? (
              <p className="px-1 text-small text-text-muted">No recent searches.</p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((c) => {
                  const current = c.id === conversationId;
                  return (
                    <li key={c.id}>
                      <Button
                        variant="quiet"
                        size="sm"
                        type="button"
                        onClick={() => onSelect(c.id)}
                        aria-current={current ? "true" : undefined}
                        className={`w-full min-w-0 justify-start ${current ? "bg-lit-muted text-accent-light" : ""}`}
                      >
                        <span className="min-w-0 truncate">
                          {c.title || "Untitled search"}
                          {c.temporary && <span className="text-text-muted"> · temporary</span>}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="border-t border-border-subtle px-1 pt-4 text-small text-text-muted">
              Chats are kept for 7 days.{" "}
              <Link href="/ai-notice" className="underline underline-offset-4 hover:text-text-primary">How AI search works</Link>
            </p>
            <Button variant="dangerGhost" size="sm" type="button" className="w-full" onClick={onDeleteAll}>
              Delete all AI history
            </Button>
          </div>
        </details>
      </Panel>
    </aside>
  );
}
