import { listTaxonomy } from "@/lib/data/taxonomy";
import OpportunityForm from "@/app/opportunities/new/OpportunityForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { Page } from "@/components/ui/Page";

export default async function AdminNewOpportunityPage() {
  const { supabase, user } = await requireAdminPage();

  const { skills, sectors } = await listTaxonomy(supabase);

  return (
    <Page width="page" as="main">
      <PageHead
        className="mb-8"
        context="Admin · direct publish"
        title="New opportunity"
        lede="Skips the approval queue — published immediately."
        actions={
          <ButtonLink href="/admin/opportunities" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={18} />}>
            Back to queue
          </ButtonLink>
        }
      />

      <OpportunityForm
        signupEmail={user.email ?? ""}
        skills={skills}
        sectors={sectors}
        mode="admin"
      />
    </Page>
  );
}
