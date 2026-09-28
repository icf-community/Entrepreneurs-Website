import "server-only";
import { rowsOrThrow, type Db } from "./query";

// In-app notifications (launch programme F-x3). Owner-scoped by the RPC.

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

/** Newest first. A failed read throws to the page's error boundary rather
 *  than posing as "no notifications". */
export async function myNotifications(db: Db, limit = 50): Promise<Notification[]> {
  const data = await rowsOrThrow("list_my_notifications", () =>
    db.rpc("list_my_notifications", { p_limit: limit }));
  return data.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}
