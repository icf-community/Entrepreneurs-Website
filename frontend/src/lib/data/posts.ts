import { rows, rowsOrThrow, type Db } from "@/lib/data/query";

// ════════════════════════════════════════════════════════════════════
// Foundry · Community feed reads
//
// Keyset paginated, unlike the directory. The reasoning is in
// 20260829000002, but the short version: this is a feed, and the expiry
// job deletes rows out from under a reader. With offset paging a post
// removed above the window shifts everything up and the next page
// silently omits one; a cursor is anchored to a row, so it cannot.
//
// This module deliberately does NOT sign image URLs. It returns blob keys
// and the pages turn them into URLs, which keeps the Azure SDK out of
// anything a unit test wants to import and keeps the cursor helpers pure.
// ════════════════════════════════════════════════════════════════════

export const FEED_PAGE_SIZE = 20;

export type PostImage = {
  blobKey: string;
  altText: string;
  width: number;
  height: number;
};

export type FeedPost = {
  id: string;
  kind: "member" | "system";
  title: string;
  body: string;
  createdAt: string;
  expiresAt: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  sourceTable: string | null;
  sourceId: string | null;
  images: PostImage[];
  likeCount: number;
  likedByMe: boolean;
};

export type MyPost = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  expiresAt: string;
  images: PostImage[];
  likeCount: number;
};

export type Cursor = { createdAt: string; id: string };

// ─── Cursor encoding ────────────────────────────────────────────────
// Opaque on purpose. The cursor is a pair of internal values that happen
// to be in the URL; base64 signals "do not hand-edit this" and means the
// shape can change without breaking a link someone has already shared.
//
// Both directions are total — a malformed cursor decodes to null and the
// caller starts from the top, which is the right failure for a truncated
// or stale URL. Never throw on a value that came out of a query string.

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`).toString("base64url");
}

export function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator < 1) return null;

    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    // Validate rather than trust: these go straight into an RPC as a
    // timestamp and a uuid, and a bad value should mean "start at the
    // top", not a database error surfaced to a member.
    if (Number.isNaN(Date.parse(createdAt))) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

    return { createdAt, id };
  } catch {
    return null;
  }
}

// The RPCs return `images` as jsonb. Narrow it here rather than trusting
// the generated `Json` type through to the components.
type RawImage = { blob_key?: unknown; alt_text?: unknown; width?: unknown; height?: unknown };

function toImages(raw: unknown): PostImage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: RawImage) => {
    if (
      typeof entry?.blob_key !== "string" ||
      typeof entry?.alt_text !== "string" ||
      typeof entry?.width !== "number" ||
      typeof entry?.height !== "number"
    ) {
      return [];
    }
    return [{ blobKey: entry.blob_key, altText: entry.alt_text, width: entry.width, height: entry.height }];
  });
}

const fullName = (first: string | null, surname: string | null): string =>
  [first, surname].filter(Boolean).join(" ").trim() || "A member";

type FeedPage<T> = { posts: T[]; nextCursor: string | null };

// Fetching one more row than the page size is how "is there more?" is
// answered without a count query — the extra row is dropped, and its
// existence is the whole answer.
function paginate<T extends { createdAt: string; id: string }>(
  fetched: T[],
  limit: number,
): FeedPage<T> {
  const hasMore = fetched.length > limit;
  const posts = hasMore ? fetched.slice(0, limit) : fetched;
  const last = posts.at(-1);
  return {
    posts,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

export async function communityFeedPage(
  db: Db,
  cursor: Cursor | null,
  limit = FEED_PAGE_SIZE,
): Promise<FeedPage<FeedPost>> {
  const data = await rows("list_community_feed", () =>
    db.rpc("list_community_feed", {
      p_cursor_created_at: cursor?.createdAt ?? undefined,
      p_cursor_id: cursor?.id ?? undefined,
      p_limit: limit + 1,
    }),
  );

  const posts: FeedPost[] = data.map((r) => ({
    id: r.id,
    kind: r.kind === "system" ? "system" : "member",
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    authorId: r.author_id,
    authorName: fullName(r.author_first_name, r.author_surname),
    authorRole: r.author_role,
    sourceTable: r.source_table,
    sourceId: r.source_id,
    images: toImages(r.images),
    likeCount: r.like_count,
    likedByMe: r.liked_by_me,
  }));

  return paginate(posts, limit);
}

export async function myPostsPage(
  db: Db,
  cursor: Cursor | null,
  limit = FEED_PAGE_SIZE,
): Promise<FeedPage<MyPost>> {
  const data = await rows("list_my_posts", () =>
    db.rpc("list_my_posts", {
      p_cursor_created_at: cursor?.createdAt ?? undefined,
      p_cursor_id: cursor?.id ?? undefined,
      p_limit: limit + 1,
    }),
  );

  const posts: MyPost[] = data.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    images: toImages(r.images),
    likeCount: r.like_count,
  }));

  return paginate(posts, limit);
}

// ─── Admin report queue ─────────────────────────────────────────────
// Offset paged, unlike the feed. This is a filtered admin list where "12
// open, page 2 of 3" is the useful framing and the reader wants a total —
// the same shape as /admin/members, and it reuses components/ui/Pager.

export const REPORTS_PAGE_SIZE = 50;

export type PostReport = {
  id: string;
  postId: string | null;
  postTitle: string;
  postStillExists: boolean;
  category: string;
  reason: string;
  status: "open" | "actioned" | "dismissed";
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reporterName: string;
  authorName: string;
  authorId: string | null;
};

export async function adminReportsPage(
  db: Db,
  filters: { status: string; page: number },
): Promise<{ reports: PostReport[]; matching: number }> {
  // B4/D3: a moderation queue that failed to load must not read as
  // "nothing to review"; it throws to admin/error.tsx with Try again.
  const data = await rowsOrThrow("admin_list_post_reports", () =>
    db.rpc("admin_list_post_reports", {
      p_status: filters.status,
      p_limit: REPORTS_PAGE_SIZE,
      p_offset: (filters.page - 1) * REPORTS_PAGE_SIZE,
    }),
  );

  const reports: PostReport[] = data.map((r) => ({
    id: r.id,
    postId: r.post_id,
    postTitle: r.post_title_snapshot,
    postStillExists: Boolean(r.post_still_exists),
    category: r.category,
    reason: r.reason,
    status: r.status as PostReport["status"],
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolutionNote: r.resolution_note,
    reporterName: fullName(r.reporter_first_name, r.reporter_surname),
    authorName: fullName(r.author_first_name, r.author_surname),
    authorId: r.author_id,
  }));

  return { reports, matching: Number(data[0]?.total_count ?? 0) };
}
