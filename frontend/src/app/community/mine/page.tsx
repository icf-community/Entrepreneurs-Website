import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { myPostsPage } from "@/lib/data/posts";
import { toMyPostView } from "../feedView";
import MyPostsClient from "./MyPostsClient";
import { Page } from "@/components/ui/Page";

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
// something before it expires. The two views are drawn as link tabs under the
// head (MyPostsClient), the same column as the feed.
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
      <Page width="page">
        <PageHead
          context="Community"
          title="My posts"
          lede={
            <>
              Everything you&rsquo;ve posted that hasn&rsquo;t expired yet. Posts are deleted
              automatically seven days after publishing, and you can remove one sooner at any time.
            </>
          }
        />

        <MyPostsClient
          initialPosts={await toMyPostView(posts)}
          initialCursor={nextCursor}
        />
      </Page>
    </AppShell>
  );
}
