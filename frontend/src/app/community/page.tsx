import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { communityFeedPage } from "@/lib/data/posts";
import { uploadsEnabled } from "@/lib/storage/uploadTicket";
import { toFeedView } from "./feedView";
import CommunityClient from "./CommunityClient";
import { Page } from "@/components/ui/Page";

// ════════════════════════════════════════════════════════════════════
// Foundry · /community
//
// This route used to 307 to /members, holding the name for exactly this.
//
// noindex is not cosmetic. The feed is member-written content behind an
// approved-members-only gate, and robots.ts already disallows /community
// — but its own comment records that Cloudflare serves a managed
// robots.txt which shadows the app's. This metadata is therefore the
// control that actually works, and the robots entry is belt and braces.
//
// The page is a reading column: PageHead, then the feed in a 720 px measure.
// ════════════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: "Community",
  robots: { index: false, follow: false },
};

export default async function CommunityPage() {
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  const { posts, nextCursor } = await communityFeedPage(supabase, null);

  return (
    <AppShell active="community" name={displayName} isAdmin={isAdmin}>
      <Page width="page">
        <PageHead
          context="Community"
          title={<>What&rsquo;s happening</>}
          lede={
            <>
              Share what you&rsquo;re building, ask for help, or point people at something worth
              seeing. Posts are visible to approved members only and are deleted automatically
              after seven days.
            </>
          }
        />

        <CommunityClient
          initialPosts={await toFeedView(posts)}
          initialCursor={nextCursor}
          currentUserId={user.id}
          isAdmin={isAdmin}
          uploadsAvailable={uploadsEnabled()}
        />
      </Page>
    </AppShell>
  );
}
