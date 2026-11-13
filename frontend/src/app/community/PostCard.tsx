"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import { closeDialog } from "@/components/ui/dialogCloser";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/forms/Field";
import { Icon } from "@/design-system/icons/Icon";
import { REPORT_CATEGORIES } from "@/lib/validation/posts";
import { adminDeletePost, deleteMyPost, reportPost, toggleLike } from "./actions";
import { ErrorBanner } from "@/components/forms/Banners";
import PostBody from "./PostBody";
import type { FeedPostView } from "./feedView";
import { settle } from "@/lib/settle";
import { useToast } from "@/components/ui/Toast";

// ════════════════════════════════════════════════════════════════════
// Foundry · One post in the feed
//
// Three controls, each shown to a different person:
//   Delete   — the author, on their own post
//   Remove   — an admin, on anything, with a reason that is emailed
//   Report   — everyone else, on someone else's post
//
// All three are real buttons with a visible shape rather than bare text.
// A control that does not read as a control is one nobody uses, and the
// takedown and report routes only work if members can find them.
//
// The look: a quiet panel. The author is a person (a ring with their
// initials), the title is the post's own heading, and the one hairline is the
// one above the actions. Your own posts wear the lit ring.
// ════════════════════════════════════════════════════════════════════

const SOURCE_HREF: Record<string, string> = {
  opportunities: "/opportunities",
  events: "/events",
  vcs_grants: "/vcs",
};

export default function PostCard({
  post,
  currentUserId,
  isAdmin,
  onRemoved,
  onLikeChanged,
}: {
  post: FeedPostView;
  currentUserId: string;
  isAdmin: boolean;
  onRemoved: (id: string) => void;
  onLikeChanged: (id: string, patch: { likeCount: number; likedByMe: boolean }) => void;
}) {
  const [dialog, setDialog] = useState<null | "delete" | "remove" | "report">(null);
  const isAuthor = post.authorId === currentUserId && post.kind === "member";
  const sourceHref = post.sourceTable ? SOURCE_HREF[post.sourceTable] : null;

  // No mirrored/synced state — `post` is the single source of truth (it's
  // kept current by CommunityClient, both right after a toggle and on its
  // polling interval; see that file's header). The only local state is a
  // transient override for the gap between clicking and the RPC replying,
  // cleared the moment it does — so there is nothing here that a changing
  // prop needs to be reconciled against.
  const [optimisticLike, setOptimisticLike] = useState<{ liked: boolean; likeCount: number } | null>(null);
  const [likePending, startLike] = useTransition();

  const liked = optimisticLike ? optimisticLike.liked : post.likedByMe;
  const likeCount = optimisticLike ? optimisticLike.likeCount : post.likeCount;

  const toast = useToast();
  const onToggleLike = () => {
    // B7: one request in flight; a second click waits for the first.
    if (likePending) return;
    const wasLiked = post.likedByMe;
    const prevCount = post.likeCount;
    setOptimisticLike({ liked: !wasLiked, likeCount: wasLiked ? prevCount - 1 : prevCount + 1 });
    startLike(async () => {
      const res = await settle(toggleLike(post.id));
      if (!res.ok) {
        setOptimisticLike(null);
        toast("Couldn't save your like. Please try again.", "error");
        return;
      }
      onLikeChanged(post.id, { likeCount: res.data.likeCount, likedByMe: res.data.liked });
      setOptimisticLike(null);
    });
  };

  return (
    <Panel as="article" className="p-5 sm:p-7">
      <header className="flex items-center gap-3.5">
        <Avatar name={post.authorName} size="md" tone={isAuthor ? "lit" : "neutral"} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-text-primary">{post.authorName}</p>
          {/* suppressHydrationWarning: this formats in the viewer's local
              zone, which legitimately differs from the server's. */}
          <p className="data mt-0.5 text-caption text-text-muted" suppressHydrationWarning>
            {new Date(post.createdAt).toLocaleDateString("en-GB", {
              day: "numeric", month: "short", year: "numeric",
            })}
          </p>
        </div>
        {post.kind === "system" && <Badge className="shrink-0">From listings</Badge>}
      </header>

      <h2 className="mt-5 break-words font-display text-title text-text-primary">
        {post.title}
      </h2>

      <div className="mt-2.5">
        <PostBody body={post.body} />
      </div>

      <PostImages images={post.images} />

      {sourceHref && (
        <Link
          href={sourceHref}
          className="mt-5 inline-flex items-center gap-1.5 text-body text-accent-light underline decoration-lit-line underline-offset-[3px] transition-colors hover:decoration-current"
        >
          <span>
            View in {sourceHref.replace("/", "")}
            <span className="sr-only"> →</span>
          </span>
          <Icon name="arrow-right" size={16} />
        </Link>
      )}

      <PostFooterActions
        post={post}
        isAuthor={isAuthor}
        isAdmin={isAdmin}
        liked={liked}
        likeCount={likeCount}
        onToggleLike={onToggleLike}
        onOpenDialog={setDialog}
      />

      {dialog === "delete" && (
        <ConfirmDelete post={post} onClose={() => setDialog(null)} onDone={onRemoved} />
      )}
      {dialog === "remove" && (
        <AdminRemove post={post} onClose={() => setDialog(null)} onDone={onRemoved} />
      )}
      {dialog === "report" && <ReportPost post={post} onClose={() => setDialog(null)} />}
    </Panel>
  );
}

// ─── Images grid ────────────────────────────────────────────────────
// Shared with My posts (it used to be copied there).
export function PostImages({ images }: { images: FeedPostView["images"] }) {
  if (images.length === 0) return null;
  return (
    <div className={`mt-5 grid gap-3 ${images.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {images.map((image) =>
        image.url ? (
          // Plain <img>, not next/image. The optimiser caches by URL and
          // a SAS URL carries an expiring token in its query string, so
          // every render would create a fresh cache entry to re-optimise
          // a file the gateway already delivered as resized WebP.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={image.blobKey}
            src={image.url}
            alt={image.altText}
            width={image.width}
            height={image.height}
            loading="lazy"
            // object-contain, not object-cover: a post image can be any
            // aspect ratio (a photo, a screenshot, a logo), and cover
            // fills the fixed 4:3 box by cropping whatever doesn't fit —
            // for anything not already 4:3 that silently cuts off edges
            // and looks nothing like what was uploaded. contain scales
            // to fit inside the box instead, letterboxed on the bg fill.
            className="aspect-[4/3] w-full rounded-lg border border-border-subtle bg-tint-1 object-contain"
          />
        ) : (
          <div
            key={image.blobKey}
            className="flex aspect-[4/3] items-center justify-center rounded-lg border border-border-subtle bg-tint-1 px-4 text-center text-small text-text-muted"
          >
            {image.altText}
          </div>
        ),
      )}
    </div>
  );
}

// ─── Like / delete / remove / report controls ──────────────────────
function PostFooterActions({
  post, isAuthor, isAdmin, liked, likeCount, onToggleLike, onOpenDialog,
}: {
  post: FeedPostView;
  isAuthor: boolean;
  isAdmin: boolean;
  liked: boolean;
  likeCount: number;
  onToggleLike: () => void;
  onOpenDialog: (dialog: "delete" | "remove" | "report") => void;
}) {
  const isMember = post.kind === "member";
  // A listing-sourced post has nothing to like or report, and only an admin can remove it: no controls, no footer.
  if (!isMember && !(isAdmin && !isAuthor)) return null;
  return (
    <footer className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle pt-4">
      {/* The optimistic count stays visible while the request runs; a
          spinner in its place hid the very number that changed (B7). A like
          is a toggle, so it is a chip: it lights, with a tick, once it is on. */}
      {isMember && (isAuthor ? (
        <span className="tnum inline-flex items-center gap-2 px-1 text-body text-text-muted">
          <Icon name="star" size={16} />
          {likeCount === 1 ? "1 like" : `${likeCount} likes`}
        </span>
      ) : (
        <Chip pressed={liked} onClick={onToggleLike}>
          {liked ? "Liked" : "Like"} ({likeCount})
        </Chip>
      ))}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {isAuthor && <PostAction kind="delete" onOpen={onOpenDialog} />}
        {isAdmin && !isAuthor && <PostAction kind="remove" onOpen={onOpenDialog} />}
        {isMember && !isAuthor && <PostAction kind="report" onOpen={onOpenDialog} />}
      </div>
    </footer>
  );
}

const ACTIONS = {
  delete: { label: "Delete", variant: "dangerGhost", icon: "trash" },
  remove: { label: "Delete post", variant: "danger", icon: "trash" },
  report: { label: "Report", variant: "ghost", icon: "flag" },
} as const;

function PostAction({ kind, onOpen }: { kind: keyof typeof ACTIONS; onOpen: (dialog: keyof typeof ACTIONS) => void }) {
  const a = ACTIONS[kind];
  return (
    <Button variant={a.variant} size="sm" leading={<Icon name={a.icon} size={18} />} onClick={() => onOpen(kind)}>
      {a.label}
    </Button>
  );
}

// ─── Author delete ──────────────────────────────────────────────────
function ConfirmDelete({
  post, onClose, onDone,
}: { post: FeedPostView; onClose: () => void; onDone: (id: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <Dialog onClose={onClose} label="Delete your post" tone="danger" className="w-full max-w-[30rem] p-6 sm:p-7 my-auto">
      <h3 className="font-display text-title text-text-primary">Delete this post?</h3>
      <p className="mt-3 text-body leading-relaxed text-text-secondary">
        &ldquo;{post.title}&rdquo; and any images on it will be removed straight away. This cannot
        be undone.
      </p>
      {error && (
        <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>
      )}
      <div className="mt-7 flex flex-wrap justify-end gap-2">
        <Button variant="quiet" size="md" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant="danger"
          size="md"
          loading={pending}
          onClick={() =>
            start(async () => {
              const res = await deleteMyPost(post.id);
              if (!res.ok) { setError(res.error); return; }
              onDone(post.id);
              onClose();
            })
          }
        >
          Delete post
        </Button>
      </div>
    </Dialog>
  );
}

// ─── Admin takedown ─────────────────────────────────────────────────
// The reason is mandatory and it is emailed to the author verbatim. That
// is the whole point of collecting it: a removal a member cannot identify
// or contest is not moderation, it is just deletion.
function AdminRemove({
  post, onClose, onDone,
}: { post: FeedPostView; onClose: () => void; onDone: (id: string) => void }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <Dialog onClose={onClose} label="Remove this post" tone="danger" className="w-full max-w-[30rem] p-6 sm:p-7 my-auto">
      <Badge tone="danger" dot>Danger zone</Badge>
      <h3 className="mt-4 font-display text-title text-text-primary">
        Remove {post.authorName}&rsquo;s post?
      </h3>
      <p className="mt-3 text-body leading-relaxed text-text-secondary">
        The post and its images are deleted immediately. A record is kept for 12 months, and the
        author is emailed your reason. This cannot be undone.
      </p>

      <div className="mt-5">
        <Field label="Reason (sent to the author)">
          <Textarea
            id={`reason-${post.id}`}
            rows={3}
            value={reason}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Which guideline does this breach?"
          />
        </Field>
      </div>

      {error && (
        <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>
      )}

      <div className="mt-7 flex flex-wrap justify-end gap-2">
        <Button variant="quiet" size="md" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant="danger"
          size="md"
          loading={pending}
          disabled={!reason.trim()}
          onClick={() =>
            start(async () => {
              const res = await adminDeletePost(post.id, reason);
              if (!res.ok) { setError(res.error); return; }
              onDone(post.id);
              onClose();
            })
          }
        >
          Remove and email author
        </Button>
      </div>
    </Dialog>
  );
}

// ─── Report ─────────────────────────────────────────────────────────
function ReportPost({ post, onClose }: { post: FeedPostView; onClose: () => void }) {
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Dialog onClose={onClose} label="Report received" className="w-full max-w-[30rem] p-6 sm:p-7 my-auto">
        <h3 className="font-display text-title text-text-primary">Thanks — that&rsquo;s with us</h3>
        <p className="mt-3 text-body leading-relaxed text-text-secondary">
          An admin will review this post. We&rsquo;ll email you once they&rsquo;ve made a decision,
          either way.
        </p>
        <div className="mt-7 flex justify-end">
          <Button variant="ghost" size="md" onClick={(e) => closeDialog(e)}>Close</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog onClose={onClose} label="Report this post" className="w-full max-w-[30rem] p-6 sm:p-7 my-auto">
      <h3 className="font-display text-title text-text-primary">Report this post</h3>
      <p className="mt-3 text-body leading-relaxed text-text-secondary">
        Tell us what&rsquo;s wrong with &ldquo;{post.title}&rdquo;. Reports go to the admin team,
        and the author is never told who reported them.
      </p>

      <div className="mt-5 grid gap-4">
        <Field label="Reason">
          <Select
            id={`cat-${post.id}`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Choose one…</option>
            {REPORT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="What should an admin know?">
          <Textarea
            id={`detail-${post.id}`}
            rows={3}
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>
      )}

      <div className="mt-7 flex flex-wrap justify-end gap-2">
        <Button variant="quiet" size="md" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant="primary"
          size="md"
          loading={pending}
          disabled={!category || reason.trim().length < 10}
          onClick={() =>
            start(async () => {
              const res = await reportPost({ postId: post.id, category, reason });
              if (!res.ok) { setError(res.error); return; }
              setDone(true);
            })
          }
        >
          Send report
        </Button>
      </div>
    </Dialog>
  );
}
