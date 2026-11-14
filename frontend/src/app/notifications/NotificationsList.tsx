"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Entry } from "@/components/ui/Entry";
import { Panel } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/design-system/icons/Icon";
import { browserClient } from "@/lib/supabase/browser";
import { invalidateUnreadBadge } from "@/components/notifications/unreadBadgeStore";
import type { Notification } from "@/lib/data/notifications";
import { track } from "@/lib/analytics/track";

// Hoisted: constructing an Intl.DateTimeFormat is comparatively expensive,
// and `when` is called once per notification on every render.
const WHEN_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

function when(iso: string): string {
  return WHEN_FORMAT.format(new Date(iso));
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
    // react-doctor-disable-next-line js-set-map-lookups -- array is provably bounded to a tiny fixed size (not user/data-scaled); O(n²) concern doesn't apply
    setItems((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
    invalidateUnreadBadge();
  }

  async function markAll() {
    setMarking(true);
    try {
      await markRead(null);
      track("notifications_marked_read");
    } catch {
      toast("Couldn't mark your notifications as read. Please try again.", "error");
    } finally {
      setMarking(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState icon="notifications">
        Nothing yet. Connection requests, listing decisions and replies to your reports show up here.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <p className="data text-body text-text-muted">{unread === 0 ? "All caught up." : `${unread} unread`}</p>
        {unread > 0 && (
          <Button variant="ghost" size="sm" loading={marking} onClick={markAll} leading={<Icon name="check" size={18} />}>
            Mark all as read
          </Button>
        )}
      </div>
      <Panel className="p-1.5">
        <ul className="grid gap-0.5">
          {items.map((n) => {
            // The words of the row. An unread one says so (for a screen reader) and is drawn in full
            // ink with a lit bell and a point of light; a read one steps back to secondary ink.
            const heading = (
              <span className={n.readAt ? "text-text-secondary" : "text-text-primary"}>
                {!n.readAt && <span className="sr-only">Unread: </span>}
                {n.title}
              </span>
            );
            return (
              <Entry
                key={n.id}
                as="li"
                glyph={<Icon name="notifications" size={20} className={n.readAt ? undefined : "text-accent-light"} />}
                title={
                  n.link ? (
                    <Link
                      href={n.link}
                      className="text-inherit no-underline after:absolute after:inset-0 after:content-['']"
                      // Best effort: navigating matters more than the read mark.
                      onClick={() => { if (!n.readAt) void markRead([n.id]).catch(() => {}); }}
                    >
                      {heading}
                    </Link>
                  ) : (
                    heading
                  )
                }
                meta={n.body ?? undefined}
                trailing={
                  <>
                    {!n.readAt && <span aria-hidden className="size-2 shrink-0 rounded-full bg-lit" />}
                    {/* suppressHydrationWarning: formats in the viewer's local
                        zone, which legitimately differs from the server's. */}
                    <span className="data text-small text-text-muted" suppressHydrationWarning>{when(n.createdAt)}</span>
                  </>
                }
              />
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
