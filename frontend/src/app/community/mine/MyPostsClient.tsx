"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { closeDialog } from "@/components/ui/dialogCloser";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { deleteMyPost, loadMoreMyPosts } from "../actions";
import PostBody from "../PostBody";
import { PostFooterActions, PostImages } from "../PostCard";
import type { MyPostView } from "../feedView";
import { ErrorBanner } from "@/components/forms/Banners";

// ════════════════════════════════════════════════════════════════════
// Foundry · My posts
//
// Every post here still expires 7 days after posting (purge_expired_posts,
// unchanged) — this view just no longer surfaces a countdown for it.
//
// The two views of the feed are real routes: the URL says which one you are
// on, and "My posts" can be linked and bookmarked. The way back to the feed is
// in the page head, where /community has its own switch.
// ════════════════════════════════════════════════════════════════════

export default function MyPostsClient({
  initialPosts,
  initialCursor,
}: {
  initialPosts: MyPostView[];
  initialCursor: string | null;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [confirming, setConfirming] = useState<MyPostView | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="grid grid-cols-1 gap-6">
      {posts.length === 0 ? (
        <EmptyState icon="community">
          You haven&rsquo;t posted anything yet, or your posts have expired.{" "}
          <Link
            href="/community"
            className="text-accent-light underline decoration-lit-line underline-offset-[3px] transition-colors hover:decoration-current"
          >
            Write one
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {posts.map((post) => (
            <Panel as="article" key={post.id} className="p-5 sm:p-7">
              {/* suppressHydrationWarning: this formats in the viewer's local
                  zone, which legitimately differs from the server's. */}
              <p className="data text-small text-text-muted" suppressHydrationWarning>
                {new Date(post.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                })}
              </p>

              <h2 className="mt-3 break-words font-display text-title text-text-primary">
                {post.title}
              </h2>
              <div className="mt-2.5">
                <PostBody body={post.body} />
              </div>

              <PostImages images={post.images} />

              {/* The same footer as the author's own post in the feed: the likes at the left, Delete at the right. */}
              <PostFooterActions
                kind="member"
                isAuthor
                isAdmin={false}
                liked={false}
                likeCount={post.likeCount}
                onOpenDialog={() => setConfirming(post)}
              />
            </Panel>
          ))}
        </div>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {cursor && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError("");
                const res = await loadMoreMyPosts(cursor);
                if (!res.ok) { setError(res.error); return; }
                setPosts((prev) => [...prev, ...res.data.posts]);
                setCursor(res.data.nextCursor);
              })
            }
          >
            Load more
          </Button>
        </div>
      )}

      {confirming && (
        <DeleteDialog
          post={confirming}
          onClose={() => setConfirming(null)}
          onDone={(id) => {
            setPosts((prev) => prev.filter((p) => p.id !== id));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({
  post, onClose, onDone,
}: { post: MyPostView; onClose: () => void; onDone: (id: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <Dialog
      onClose={onClose}
      label="Delete your post"
      tone="danger"
      className="w-full max-w-[30rem] p-6 sm:p-7 my-auto"
    >
      <h3 className="font-display text-title text-text-primary">Delete this post?</h3>
      <p className="mt-3 text-body leading-relaxed text-text-secondary">
        &ldquo;{post.title}&rdquo; and any images on it will be removed straight away. This cannot
        be undone.
      </p>
      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}
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
