import AppShell from "@/components/app/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { committeeMembers } from "@/lib/data/committee";
import CommitteeGallery from "./CommitteeGallery";

export default async function CommitteePage() {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();
  const members = await committeeMembers(supabase);

  return (
    <AppShell active="committee" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHead
            context="Meet the Committee"
            title="The people running the Foundry"
            lede="Use the arrows (or ← →) to page through everyone. Click a card for their full profile."
            className="mb-10"
          />

          {members.length === 0 ? (
            <EmptyState icon="committee" className="mx-auto max-w-[820px]">
              No committee members have been added yet.
            </EmptyState>
          ) : (
            <CommitteeGallery members={members} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
