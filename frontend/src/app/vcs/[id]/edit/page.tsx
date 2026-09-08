import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { vcForEdit } from "@/lib/data/vcs";
import VcForm, { type VcInitialValues } from "../../new/VcForm";
import { EditStatusNote, QueuedRevisionBanner } from "@/components/forms/EditStatusNote";
import { pendingRevision } from "@/lib/listings/pendingRevision";

type Params = { id: string };

export default async function EditVcGrantPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  const row = await vcForEdit(supabase, id);
  if (!row) notFound();
  if (row.posted_by !== user.id) notFound();
  if (row.status !== "pending" && row.status !== "approved") notFound();

  const revision = row.status === "approved"
    ? await pendingRevision(supabase, "vc_grant", id)
    : null;
  const src = { ...row, ...(revision?.proposed ?? {}) };

  const initialValues: VcInitialValues = {
    kind:        src.kind as typeof row.kind,
    name:        String(src.name),
    description: String(src.description),
    link:        String(src.link),
    amount:      src.amount == null ? "" : String(src.amount),
    deadline:    src.deadline == null ? "" : String(src.deadline),
    stage:       src.stage == null ? "" : String(src.stage),
  };

  return (
    <AppShell active="vcs" name={displayName} isAdmin={isAdmin}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[820px] mx-auto">
          <Link href="/my-submissions" className="inline-flex items-center text-[0.8rem] text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary mb-6">
            ← Your submissions
          </Link>
          <div className="mb-10 rule-draw pt-6">
            <p className="label-wide text-text-secondary mb-3">Edit {row.kind === "vc" ? "VC" : "grant"}</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-[clamp(1.75rem,3vw,2.5rem)]">
              {row.name}
            </h1>
            <EditStatusNote status={row.status} noun="listing" />
          </div>
          {revision && <QueuedRevisionBanner queuedAt={revision.createdAt} />}
          <VcForm
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
