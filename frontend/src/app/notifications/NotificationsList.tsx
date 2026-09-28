"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { browserClient } from "@/lib/supabase/browser";
import { invalidateUnreadBadge } from "@/components/notifications/UnreadBadge";
import type { Notification } from "@/lib/data/notifications";

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso));
}

export default function NotificationsList({ initial }: { initial: Notification[] }) {
  const [items, setItems] = useState(initial);
  const [marking, setMarking] = useState(false);
  const toast = useToast();
  const unread = items.filter((n) => !n.readAt).length;

  async function markRead(ids: string[] | null) {
    const { error } = await browserClient().rpc("mark_notifications_read", ids ? { p_ids: ids } : {});
    if (error) throw error;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
    invalidateUnreadBadge();
  }

  async function markAll() {
    setMarking(true);
    try {
      await markRead(null);
    } catch {
      toast("Couldn't mark your notifications as read. Please try again.", "error");
    } finally {
      setMarking(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-bg-card p-6 text-[0.85rem] text-text-muted">
        Nothing yet. Connection requests, listing decisions and replies to your reports show up here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8rem] text-text-muted">{unread === 0 ? "All caught up." : `${unread} unread`}</p>
        {unread > 0 && (
          <Button variant="ghost" size="sm" loading={marking} onClick={markAll}>
            Mark all as read
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {items.map((n) => {
          const content = (
            <>
              <span className="flex items-start justify-between gap-3">
                <span className={`text-[0.875rem] ${n.readAt ? "text-text-secondary" : "font-medium text-text-primary"}`}>
                  {!n.readAt && <span className="sr-only">Unread: </span>}
                  {n.title}
                </span>
                <span className="shrink-0 text-[0.72rem] text-text-muted">{when(n.createdAt)}</span>
              </span>
              {n.body && <span className="mt-1 block text-[0.8rem] text-text-muted">{n.body}</span>}
            </>
          );
          const cls = `block rounded-xl border px-4 py-3 no-underline transition-colors ${
            n.readAt ? "border-border bg-white/[0.02]" : "border-border-strong bg-white/[0.05]"
          }`;
          return (
            <li key={n.id}>
              {n.link ? (
                <Link
                  href={n.link}
                  className={`${cls} hover:border-accent`}
                  // Best effort: navigating matters more than the read mark.
                  onClick={() => { if (!n.readAt) void markRead([n.id]).catch(() => {}); }}
                >
                  {content}
                </Link>
              ) : (
                <div className={cls}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
