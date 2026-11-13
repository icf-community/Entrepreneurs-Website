"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { loadMoreFeed, refreshLikeCounts } from "./actions";
import PostCard from "./PostCard";
import PostComposer from "./PostComposer";
import { ErrorBanner } from "@/components/forms/Banners";
import type { FeedPostView } from "./feedView";

// ════════════════════════════════════════════════════════════════════
// Foundry · The feed
//
// Posts accumulate client-side as the reader pages, because a feed that
// replaces the list on "load more" loses your place. The cursor is opaque
// and comes from the server; this component never constructs one.
//
// The list is owned by this component from mount onward, and every change
// to it is applied here directly: a new post is prepended from what the
// action returned, a deleted one is filtered out.
//
// It deliberately does NOT lean on router.refresh() to show a new post.
// useState seeds from props once and React ignores prop changes after
// mount, so a refreshed server render never reaches this list — which is
// exactly the bug the E2E suite caught: posting worked, and the card only
// appeared after a hard reload. revalidatePath still runs in the action so
// the *next* navigation is correct.
//
// Like counts are the one thing this component pulls from the server
// without an action here: once, when the reader comes back to the tab —
// see the effect below for why not live, and how it avoids fighting an
// in-flight optimistic update on any one card.
// ════════════════════════════════════════════════════════════════════

export default function CommunityClient({
  initialPosts,
  initialCursor,
  currentUserId,
  isAdmin,
  uploadsAvailable,
}: {
  initialPosts: FeedPostView[];
  initialCursor: string | null;
  currentUserId: string;
  isAdmin: boolean;
  uploadsAvailable: boolean;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [composerOpen, setComposerOpen] = useState(false);

  const removePost = (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    router.refresh();
  };

  // Fresh likes when the reader returns to the tab, and no other time.
  // This used to poll every 45 s, a billed call per open feed whether or
  // not anything changed. Pushing each like over Realtime would be worse:
  // one message per like per open feed, the shape that runs up the message
  // quota (see 20261111000001's header), for a cosmetic count. Your own
  // likes update instantly from the toggle; other people's appear on return
  // or on the next load. Merges just the two like fields into whatever's
  // already rendered; title/body/images/pagination are untouched, so it
  // can't stomp a card mid-edit or mid-delete.
  const postsRef = useRef(posts);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const updateLike = (id: string, patch: { likeCount: number; likedByMe: boolean }) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  useEffect(() => {
    const refresh = async () => {
      const ids = postsRef.current.filter((p) => p.kind === "member").map((p) => p.id);
      if (ids.length === 0) return;
      const res = await refreshLikeCounts(ids);
      if (!res.ok) return;
      setPosts((prev) => prev.map((p) => (res.data[p.id] ? { ...p, ...res.data[p.id] } : p)));
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <div className="space-y-6">
      <nav aria-label="Community actions" className="flex justify-end gap-2">
        <Link
          href="/community/mine"
          className="rounded-lg border border-border-strong bg-tint-1 px-4 py-2 text-body text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
        >
          My posts
        </Link>
        <Button variant={composerOpen ? "ghost" : "primary"} size="sm" onClick={() => setComposerOpen((v) => !v)}>
          {composerOpen ? "Cancel" : "Create a post"}
        </Button>
      </nav>

      {composerOpen && (
        <PostComposer
          uploadsAvailable={uploadsAvailable}
          onPosted={(post) => {
            setPosts((prev) => [post, ...prev]);
            setComposerOpen(false);
          }}
        />
      )}

      {posts.length === 0 ? (
        <p className="rounded-xl border border-border-subtle bg-tint-1 px-6 py-12 text-center text-body text-text-secondary">
          Nothing here yet. Be the first to post something.
        </p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onRemoved={removePost}
              onLikeChanged={updateLike}
            />
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
                const res = await loadMoreFeed(cursor);
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
    </div>
  );
}
