import {
  listPendingListingEdits,
  changedFields,
  FIELD_LABELS,
} from "@/lib/listings/edits";
import EditsReview from "./EditsReview";
import { requireAdminPage } from "@/lib/auth/guard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { Page } from "@/components/ui/Page";

export default async function AdminListingEditsPage() {
  await requireAdminPage();
  const items = await listPendingListingEdits();

  // The diff is computed here, not in the client component, so the same
  // function decides what the reviewer sees and what the proposal email
  // said changed.
  const changed = Object.fromEntries(
    items.map((e) => [e.id, changedFields(e.current, e.proposed)]),
  );

  return (
    <Page as="main">
      <PageHead
        className="mb-8"
        context="Admin · review queue"
        title="Proposed changes"
        lede={
          <>
            {items.length} waiting. Each of these listings is <em>already live</em> and stays
            live exactly as published until you approve the change — nothing here is
            currently hidden from members.
          </>
        }
        actions={
          <ButtonLink href="/admin" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={18} />}>
            Admin home
          </ButtonLink>
        }
      />

      <EditsReview items={items} labels={FIELD_LABELS} changed={changed} />
    </Page>
  );
}
