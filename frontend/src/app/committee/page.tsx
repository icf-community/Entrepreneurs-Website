import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { committeeMembers } from "@/lib/data/committee";
import CommitteeGallery from "./CommitteeGallery";

export default async function CommitteePage() {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();
  const members = await committeeMembers(supabase);

  return (
    <AppShell active="committee" name={displayName} isAdmin={isAdmin}>
      <div className="px-6 sm:px-8 py-12">
        <div className="max-w-[1100px] mx-auto">
          <div className="mb-8 rule-draw pt-4 max-w-[820px]">
            <p className="label-wide text-text-muted mb-6">Meet the Committee</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-display">
              The people running the Foundry
            </h1>
            <p className="text-body text-text-muted mt-3 leading-relaxed">
              Use the arrows (or ← →) to page through everyone. Click a card for their full profile.
            </p>
          </div>

          {members.length === 0 ? (
            <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-body text-text-muted max-w-[820px] mx-auto">
              No committee members have been added yet.
            </div>
          ) : (
            <CommitteeGallery members={members} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
