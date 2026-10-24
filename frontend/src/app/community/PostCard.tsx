"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { closeDialog } from "@/components/ui/dialogCloser";
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
    <article className="rounded-xl border border-border-subtle bg-white/[0.02] p-5 sm:p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.8rem] text-text-primary font-medium truncate">{post.authorName}</p>
          {/* suppressHydrationWarning: this formats in the viewer's local
              zone, which legitimately differs from the server's. */}
          <p className="mt-0.5 text-[0.7rem] text-text-muted" suppressHydrationWarning>
            {new Date(post.createdAt).toLocaleDateString("en-GB", {
              day: "numeric", month: "short", year: "numeric",
            })}
          </p>
        </div>
        {post.kind === "system" && (
          <span className="shrink-0 rounded-full border border-border-strong px-2.5 py-1 text-[0.65rem] uppercase tracking-wider text-text-muted">
            From listings
          </span>
        )}
      </header>

      <h2 className="mt-4 text-[1.05rem] font-medium tracking-tight text-text-primary break-words">
        {post.title}
      </h2>

      <div className="mt-2">
        <PostBody body={post.body} />
      </div>

      <PostImages images={post.images} />

      {sourceHref && (
        <Link
          href={sourceHref}
          className="mt-4 inline-block text-[0.8rem] text-text-primary underline decoration-border-strong underline-offset-2 hover:decoration-accent"
        >
          View in {sourceHref.replace("/", "")} →
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
    </article>
  );
}

// ─── Images grid ────────────────────────────────────────────────────
function PostImages({ images }: { images: FeedPostView["images"] }) {
  if (images.length === 0) return null;
  return (
    <div className={`mt-4 grid gap-3 ${images.length > 1 ? "sm:grid-cols-2" : ""}`}>
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
            className="w-full aspect-[4/3] rounded-lg border border-border-subtle bg-white/[0.02] object-contain"
          />
        ) : (
          <div
            key={image.blobKey}
            className="flex aspect-[4/3] items-center justify-center rounded-lg border border-border-subtle bg-white/[0.02] px-4 text-center text-[0.75rem] text-text-muted"
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
  return (
    <footer className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
      {post.kind === "member" && isAuthor && (
        <span className="tnum px-1 text-[0.8rem] text-text-muted">
          {likeCount === 1 ? "1 like" : `${likeCount} likes`}
        </span>
      )}
      {/* The optimistic count stays visible while the request runs; a
          spinner in its place hid the very number that changed (B7). */}
      {post.kind === "member" && !isAuthor && (
        <Button variant="ghost" size="sm" aria-pressed={liked} onClick={onToggleLike}>
          {liked ? "Liked" : "Like"} ({likeCount})
        </Button>
      )}
      {isAuthor && (
        <Button variant="dangerGhost" size="sm" onClick={() => onOpenDialog("delete")}>
          Delete
        </Button>
      )}
      {isAdmin && !isAuthor && (
        <Button variant="danger" size="sm" onClick={() => onOpenDialog("remove")}>
          Delete post
        </Button>
      )}
      {!isAuthor && post.kind === "member" && (
        <Button variant="ghost" size="sm" onClick={() => onOpenDialog("report")}>
          Report
        </Button>
      )}
    </footer>
  );
}

// ─── Author delete ──────────────────────────────────────────────────
function ConfirmDelete({
  post, onClose, onDone,
}: { post: FeedPostView; onClose: () => void; onDone: (id: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <Dialog onClose={onClose} label="Delete your post" className="w-full max-w-md rounded-xl border border-border-strong bg-bg-primary p-6">
      <h3 className="font-display text-[1.1rem] text-text-primary">Delete this post?</h3>
      <p className="mt-2 text-[0.85rem] text-text-secondary leading-relaxed">
        &ldquo;{post.title}&rdquo; and any images on it will be removed straight away. This cannot
        be undone.
      </p>
      {error && (
        <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant="danger"
          size="sm"
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
    <Dialog onClose={onClose} label="Remove this post" className="w-full max-w-md rounded-xl border border-[#ff4d4d]/30 bg-bg-primary p-6">
      <p className="label-wide text-[#ff6b6b]">Danger zone</p>
      <h3 className="mt-3 font-display text-[1.1rem] text-text-primary">
        Remove {post.authorName}&rsquo;s post?
      </h3>
      <p className="mt-2 text-[0.85rem] text-text-secondary leading-relaxed">
        The post and its images are deleted immediately. A record is kept for 12 months, and the
        author is emailed your reason. This cannot be undone.
      </p>

      <label htmlFor={`reason-${post.id}`} className="mt-5 block text-[0.75rem] text-text-muted">
        Reason (sent to the author)
      </label>
      <textarea
        id={`reason-${post.id}`}
        rows={3}
        value={reason}
        maxLength={2000}
        onChange={(e) => setReason(e.target.value)}
        className="mt-2 w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.85rem] text-text-primary"
        placeholder="Which guideline does this breach?"
      />

      {error && (
        <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant="danger"
          size="sm"
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
      <Dialog onClose={onClose} label="Report received" className="w-full max-w-md rounded-xl border border-border-strong bg-bg-primary p-6">
        <h3 className="font-display text-[1.1rem] text-text-primary">Thanks — that&rsquo;s with us</h3>
        <p className="mt-2 text-[0.85rem] text-text-secondary leading-relaxed">
          An admin will review this post. We&rsquo;ll email you once they&rsquo;ve made a decision,
          either way.
        </p>
        <div className="mt-6 flex justify-end">
          <Button variant="ghost" size="sm" onClick={(e) => closeDialog(e)}>Close</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog onClose={onClose} label="Report this post" className="w-full max-w-md rounded-xl border border-border-strong bg-bg-primary p-6">
      <h3 className="font-display text-[1.1rem] text-text-primary">Report this post</h3>
      <p className="mt-2 text-[0.85rem] text-text-secondary leading-relaxed">
        Tell us what&rsquo;s wrong with &ldquo;{post.title}&rdquo;. Reports go to the admin team,
        and the author is never told who reported them.
      </p>

      <label htmlFor={`cat-${post.id}`} className="mt-5 block text-[0.75rem] text-text-muted">
        Reason
      </label>
      <select
        id={`cat-${post.id}`}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="mt-2 w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.85rem] text-text-primary"
      >
        <option value="">Choose one…</option>
        {REPORT_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      <label htmlFor={`detail-${post.id}`} className="mt-4 block text-[0.75rem] text-text-muted">
        What should an admin know?
      </label>
      <textarea
        id={`detail-${post.id}`}
        rows={3}
        value={reason}
        maxLength={1000}
        onChange={(e) => setReason(e.target.value)}
        className="mt-2 w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.85rem] text-text-primary"
      />

      {error && (
        <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
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
