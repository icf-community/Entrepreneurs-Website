import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { listTaxonomy } from "@/lib/data/taxonomy";
import OpportunityForm from "./OpportunityForm";

export default async function NewOpportunityPage() {
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  const { skills, sectors } = await listTaxonomy(supabase);

  return (
    <AppShell active="opportunities" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[820px]">
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
        </div>
      </div>
    </AppShell>
  );
}
