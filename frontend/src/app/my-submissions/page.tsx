import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { InfoTip } from "@/components/ui/Tooltip";
import { requireApprovedUser } from "@/lib/auth/guard";
import { myListingStats, statsKey } from "@/lib/data/activity";
import { mySubmissions } from "@/lib/data/ownListings";
import MySubmissionsClient from "./MySubmissionsClient";

export default async function MySubmissionsPage() {
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  const [own, stats] = await Promise.all([
    mySubmissions(supabase, user.id),
    myListingStats(supabase),
  ]);

  // A listing has no stats row until someone views or clicks it, so an
  // absent key is a real zero rather than a missing read.
  const statFor = (kind: "opportunity" | "event" | "vc_grant", id: string) =>
    stats.get(statsKey(kind, id)) ?? { views: 0, clicks: 0 };

  const opportunities = own.opportunities.map((r) => ({
    id: r.id, title: r.position_name, subtitle: r.company,
    status: r.status, createdAt: r.created_at,
    rejectedReason: r.rejected_reason,
    stats: statFor("opportunity", r.id),
  }));
  const events = own.events.map((r) => ({
    id: r.id, title: r.title, subtitle: null,
    status: r.status, createdAt: r.created_at,
    rejectedReason: r.rejected_reason,
    stats: statFor("event", r.id),
  }));
  const vcs = own.vcs.map((r) => ({
    id: r.id, title: r.name, subtitle: r.kind,
    status: r.status, createdAt: r.created_at,
    rejectedReason: r.rejected_reason,
    stats: statFor("vc_grant", r.id),
  }));

  return (
    <AppShell active="submissions" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[44rem]">
          <PageHead
            context="Your submissions"
            title="Everything you've posted"
            className="mb-8"
            lede={
              <>
                Every opportunity, event, and VC/grant you&apos;ve posted, across all statuses. View and click counts are recorded once they go live — only other members count, not you.{" "}
                {/* The rules for editing and deleting sit one press away: the same words, out of the masthead. */}
                <InfoTip label="Editing and deleting">
                  You can edit pending listings, and delete any of them at any time. Deleting an approved listing removes it from the community directory immediately and cannot be undone.
                </InfoTip>
              </>
            }
          />
          <MySubmissionsClient opportunities={opportunities} events={events} vcs={vcs} />
        </div>
      </div>
    </AppShell>
  );
}
