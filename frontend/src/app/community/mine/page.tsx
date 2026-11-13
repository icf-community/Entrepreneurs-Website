import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { myPostsPage } from "@/lib/data/posts";
import { toMyPostView } from "../feedView";
import MyPostsClient from "./MyPostsClient";

// ════════════════════════════════════════════════════════════════════
// Foundry · /community/mine
//
// "My posts" is a tab here rather than an eleventh item in the sidebar.
// The rail is already at seven primary rows plus four secondary, and a
// view that only matters to members who have posted belongs where the
// posts are, not competing with Home and Members for a place in the rail.
//
// It is a real route, not client state, so it can be linked and
// bookmarked — which is what a member wants when they come back to delete
// something before it expires.
// ════════════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: "My posts",
  robots: { index: false, follow: false },
};

export default async function MyPostsPage() {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();
  const { posts, nextCursor } = await myPostsPage(supabase, null);

  return (
    <AppShell active="community" name={displayName} isAdmin={isAdmin}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[720px] mx-auto">
          <div className="mb-8 rule-draw pt-4">
            <p className="label-wide text-text-muted mb-6">Community</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-display">
              My posts
            </h1>
            <p className="mt-3 text-body text-text-secondary leading-relaxed">
              Everything you&rsquo;ve posted that hasn&rsquo;t expired yet. Posts are deleted
              automatically seven days after publishing, and you can remove one sooner at any time.
            </p>
          </div>

          <MyPostsClient
            initialPosts={await toMyPostView(posts)}
            initialCursor={nextCursor}
          />
        </div>
      </div>
    </AppShell>
  );
}
