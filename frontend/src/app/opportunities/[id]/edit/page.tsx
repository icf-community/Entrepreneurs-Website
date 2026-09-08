import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { listTaxonomy, opportunityTaxonomy } from "@/lib/data/taxonomy";
import { opportunityForEdit } from "@/lib/data/opportunities";
import OpportunityForm, { type OpportunityInitialValues } from "../../new/OpportunityForm";
import { EditStatusNote, QueuedRevisionBanner } from "@/components/forms/EditStatusNote";
import { pendingRevision } from "@/lib/listings/pendingRevision";

type Params = { id: string };

export default async function EditOpportunityPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  // SECURITY DEFINER RPC enforces caller = poster and returns
  // contact_email accordingly (migration 20260530000002).
  const [row, taxonomy, selected] = await Promise.all([
    opportunityForEdit(supabase, id),
    listTaxonomy(supabase),
    opportunityTaxonomy(supabase, id),
  ]);

  if (!row) notFound();
  // posted_by check happens inside the RPC; status still gates which
  // path an edit takes — approved goes through review (20260907000005).
  if (row.status !== "pending" && row.status !== "approved") notFound();

  const revision = row.status === "approved"
    ? await pendingRevision(supabase, "opportunity", id)
    : null;
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
    skillIds:            (p.skill_ids  as number[] | undefined) ?? selected.skillIds,
    sectorIds:           (p.sector_ids as number[] | undefined) ?? selected.sectorIds,
  };

  return (
    <AppShell active="opportunities" name={displayName} isAdmin={isAdmin}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[820px] mx-auto">
          <Link href="/my-submissions" className="inline-flex items-center text-[0.8rem] text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary mb-6">
            ← Your submissions
          </Link>
          <div className="mb-10 rule-draw pt-6">
            <p className="label-wide text-text-secondary mb-3">Edit opportunity</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-[clamp(1.75rem,3vw,2.5rem)]">
              {row.position_name}
            </h1>
            <EditStatusNote status={row.status} noun="opportunity" />
          </div>
          {revision && <QueuedRevisionBanner queuedAt={revision.createdAt} />}
          <OpportunityForm
            signupEmail={user.email ?? ""}
            skills={taxonomy.skills}
            sectors={taxonomy.sectors}
            mode="user"
            editingId={id}
            initialValues={initialValues}
            reviewOnSave={row.status === "approved"}
          />
        </div>
      </div>
    </AppShell>
  );
}
