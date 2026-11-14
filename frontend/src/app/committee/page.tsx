import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { committeeMembers } from "@/lib/data/committee";
import CommitteeGallery from "./CommitteeGallery";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Meet the Committee" };

export default async function CommitteePage() {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();
  const members = await committeeMembers(supabase);

  return (
    <AppShell active="committee" name={displayName} isAdmin={isAdmin}>
      <Page>
        <PageHead
          context="Meet the Committee"
          title="The people running the Foundry"
          lede="Use the arrows (or ← →) to page through everyone. Click a card for their full profile."
          className="mb-10"
        />

        {members.length === 0 ? (
          <EmptyState icon="committee">
            No committee members have been added yet.
          </EmptyState>
        ) : (
          <CommitteeGallery members={members} />
        )}
      </Page>
    </AppShell>
  );
}
