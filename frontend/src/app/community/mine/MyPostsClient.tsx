"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { closeDialog } from "@/components/ui/dialogCloser";
import { deleteMyPost, loadMoreMyPosts } from "../actions";
import PostBody from "../PostBody";
import type { MyPostView } from "../feedView";
import { ErrorBanner } from "@/components/forms/Banners";

// ════════════════════════════════════════════════════════════════════
// Foundry · My posts
//
// Every post here still expires 7 days after posting (purge_expired_posts,
// unchanged) — this view just no longer surfaces a countdown for it.
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
    <div className="space-y-6">
      <nav aria-label="Community views" className="flex gap-2">
        <Link
          href="/community"
          className="rounded-lg border border-border-strong bg-tint-1 px-4 py-2 text-body text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
        >
          All posts
        </Link>
        <span className="rounded-lg border border-accent bg-tint-2 px-4 py-2 text-body text-text-primary">
          My posts
        </span>
      </nav>

      {posts.length === 0 ? (
        <p className="rounded-xl border border-border-subtle bg-tint-1 px-6 py-12 text-center text-body text-text-secondary">
          You haven&rsquo;t posted anything yet, or your posts have expired.{" "}
          <Link href="/community" className="text-text-primary underline underline-offset-2">
            Write one
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <article
              key={post.id}
              className="rounded-xl border border-border-subtle bg-tint-1 p-5 sm:p-6"
            >
              {/* suppressHydrationWarning: this formats in the viewer's local
                  zone, which legitimately differs from the server's. */}
              <p className="text-small text-text-muted" suppressHydrationWarning>
                {new Date(post.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                })}
                <span aria-hidden className="mx-1.5">·</span>
                <span className="tnum">{post.likeCount === 1 ? "1 like" : `${post.likeCount} likes`}</span>
              </p>

              <h2 className="mt-3 text-lead font-medium tracking-tight text-text-primary break-words">
                {post.title}
              </h2>
              <div className="mt-2">
                <PostBody body={post.body} />
              </div>

              {post.images.length > 0 && (
                <div className={`mt-4 grid gap-3 ${post.images.length > 1 ? "sm:grid-cols-2" : ""}`}>
                  {post.images.map((image) =>
                    image.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={image.blobKey}
                        src={image.url}
                        alt={image.altText}
                        width={image.width}
                        height={image.height}
                        loading="lazy"
                        // object-contain: see PostCard.tsx's own image for why —
                        // object-cover crops anything that isn't already 4:3.
                        className="w-full aspect-[4/3] rounded-lg border border-border-subtle bg-tint-1 object-contain"
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
              )}

              <div className="mt-5 border-t border-border-subtle pt-4">
                <Button variant="dangerGhost" size="sm" onClick={() => setConfirming(post)}>
                  Delete
                </Button>
              </div>
            </article>
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
      className="w-full max-w-md rounded-xl border border-border-strong bg-bg-primary p-6"
    >
      <h3 className="font-display text-lead text-text-primary">Delete this post?</h3>
      <p className="mt-2 text-body text-text-secondary leading-relaxed">
        &ldquo;{post.title}&rdquo; and any images on it will be removed straight away. This cannot
        be undone.
      </p>
      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}
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
