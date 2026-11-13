import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { communityFeedPage } from "@/lib/data/posts";
import { uploadsEnabled } from "@/lib/storage/uploadTicket";
import { toFeedView } from "./feedView";
import CommunityClient from "./CommunityClient";

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
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[720px] mx-auto">
          <div className="mb-8 rule-draw pt-4">
            <p className="label-wide text-text-muted mb-6">Community</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-display">
              What&rsquo;s happening
            </h1>
            <p className="mt-3 text-body text-text-secondary leading-relaxed">
              Share what you&rsquo;re building, ask for help, or point people at something worth
              seeing. Posts are visible to approved members only and are deleted automatically
              after seven days.
            </p>
          </div>

          <CommunityClient
            initialPosts={await toFeedView(posts)}
            initialCursor={nextCursor}
            currentUserId={user.id}
            isAdmin={isAdmin}
            uploadsAvailable={uploadsEnabled()}
          />
        </div>
      </div>
    </AppShell>
  );
}
