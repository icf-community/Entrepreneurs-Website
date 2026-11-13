import { listTaxonomy } from "@/lib/data/taxonomy";
import OpportunityForm from "@/app/opportunities/new/OpportunityForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";

export default async function AdminNewOpportunityPage() {
  const { supabase, user } = await requireAdminPage();

  const { skills, sectors } = await listTaxonomy(supabase);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-[var(--gutter)] py-10 sm:py-12 text-text-primary">
      <div className="mx-auto max-w-[720px]">
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
      </div>
    </main>
  );
}
