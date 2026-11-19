import type { Metadata } from "next";
import { isUuid } from "@/lib/uuid";
import { notFound } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { listTaxonomy } from "@/lib/data/taxonomy";
import { listingEditSnapshot } from "@/lib/listings/editSnapshot";
import OpportunityForm, { type OpportunityInitialValues } from "../../new/OpportunityForm";
import { EditStatusNote, QueuedRevisionBanner } from "@/components/forms/EditStatusNote";
import { Page } from "@/components/ui/Page";
import { Trail } from "@/components/ui/Trail";

export const metadata: Metadata = { title: "Edit opportunity" };

type Params = { id: string };

export default async function EditOpportunityPage({ params }: { params: Promise<Params> }) {
  const [{ id }, { supabase, user, isAdmin, displayName }] = await Promise.all([
    params,
    requireApprovedUser(),
  ]);

  // A malformed id is a 404, not an RPC call that raises 22P02.
  if (!isUuid(id)) notFound();

  // SECURITY DEFINER RPC enforces caller = poster and returns
  // contact_email accordingly (migration 20260530000002).
  const [snapshot, taxonomy] = await Promise.all([
    listingEditSnapshot(supabase, "opportunity", id), listTaxonomy(supabase),
  ]);
  const row = snapshot?.row;
  if (!row) notFound();
  // posted_by check happens inside the RPC; status still gates which
  // path an edit takes — approved goes through review (20260907000005).
  if (row.status !== "pending" && row.status !== "approved") notFound();

  const revision = snapshot?.revision;
  const p = revision?.proposed ?? {};
  const src = { ...row, ...p };

  const initialValues: OpportunityInitialValues = {
    positionName:        String(src.position_name),
    company:             String(src.company),
    pay:                 String(src.pay),
    locationType:        src.location_type as typeof row.location_type,
    locationText:        src.location_text == null ? "" : String(src.location_text),
    description:         String(src.description),
    startMonth:          String(src.start_month),
    startYear:           String(src.start_year),
    applicationDeadline: String(src.application_deadline),
    contactEmail:        String(src.contact_email),
    contactEmailVisible: Boolean(src.contact_email_visible),
    applyMethod:         src.apply_method as typeof row.apply_method,
    applyUrl:            src.apply_url == null ? "" : String(src.apply_url),
    skillIds:            (p.skill_ids  as number[] | undefined) ?? row.skill_ids,
    sectorIds:           (p.sector_ids as number[] | undefined) ?? row.sector_ids,
    eligibleAudience:    (src.eligible_audience as OpportunityInitialValues["eligibleAudience"]) ?? null,
  };

  return (
    <AppShell active="opportunities" name={displayName} isAdmin={isAdmin}>
      <Page width="page">
        <PageHead
          className="mb-8"
          context={<Trail href="/my-submissions" label="Your submissions" current="Edit opportunity" />}
          title={row.position_name}
          lede={<EditStatusNote status={row.status} noun="opportunity" />}
        />
        {revision && <QueuedRevisionBanner queuedAt={revision.createdAt} />}
        <OpportunityForm
          signupEmail={user.email ?? ""}
          skills={taxonomy.skills}
          sectors={taxonomy.sectors}
          mode="user"
          editingId={id}
          editVersion={row.edit_version}
          initialValues={initialValues}
          reviewOnSave={row.status === "approved"}
        />
      </Page>
    </AppShell>
  );
}
