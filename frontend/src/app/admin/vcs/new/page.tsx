import VcForm from "@/app/vcs/new/VcForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { Page } from "@/components/ui/Page";

export default async function AdminNewVcPage() {
  await requireAdminPage();
  return (
    <Page width="page" as="main">
      <PageHead
        className="mb-8"
        context="Admin · direct publish"
        title="New VC / grant"
        lede="Skips the approval queue — published immediately."
        actions={
          <ButtonLink href="/admin/vcs" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={18} />}>
            Back to queue
          </ButtonLink>
        }
      />

      <VcForm mode="admin" />
    </Page>
  );
}
