import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { listTaxonomy } from "@/lib/data/taxonomy";
import OpportunityForm from "./OpportunityForm";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Post an opportunity" };

export default async function NewOpportunityPage() {
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  const { skills, sectors } = await listTaxonomy(supabase);

  return (
    <AppShell active="opportunities" name={displayName} isAdmin={isAdmin}>
      <Page width="page">
        <PageHead
          className="mb-8"
          context="Post an opportunity"
          title="Share a role with the network"
          lede="Submissions go to the admin queue for review before they appear on the Opportunities tab."
        />

        <OpportunityForm
          signupEmail={user.email ?? ""}
          skills={skills}
          sectors={sectors}
          mode="user"
        />
      </Page>
    </AppShell>
  );
}
