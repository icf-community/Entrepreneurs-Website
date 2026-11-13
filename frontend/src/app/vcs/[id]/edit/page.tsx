import { isUuid } from "@/lib/uuid";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { requireApprovedUser } from "@/lib/auth/guard";
import { listingEditSnapshot } from "@/lib/listings/editSnapshot";
import VcForm, { type VcInitialValues } from "../../new/VcForm";
import { EditStatusNote, QueuedRevisionBanner } from "@/components/forms/EditStatusNote";

type Params = { id: string };

export default async function EditVcGrantPage({ params }: { params: Promise<Params> }) {
  const [{ id }, { supabase, user, isAdmin, displayName }] = await Promise.all([
    params,
    requireApprovedUser(),
  ]);

  // A malformed id is a 404, not an RPC call that raises 22P02.
  if (!isUuid(id)) notFound();

  const snapshot = await listingEditSnapshot(supabase, "vc_grant", id);
  const row = snapshot?.row;
  if (!row) notFound();
  if (row.posted_by !== user.id) notFound();
  if (row.status !== "pending" && row.status !== "approved") notFound();

  const revision = snapshot?.revision;
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
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[820px]">
          <PageHead
            className="mb-8"
            context={
              <>
                {/* The arrow is drawn; the character stays as hidden text so the link's name is still "← Your submissions". */}
                <Link href="/my-submissions" className="inline-flex items-center gap-1.5">
                  <Icon name="arrow-left" size={16} />
                  <span className="sr-only">← </span>
                  Your submissions
                </Link>
                <span aria-hidden="true">/</span>
                Edit {row.kind === "vc" ? "VC" : "grant"}
              </>
            }
            title={row.name}
            lede={<EditStatusNote status={row.status} noun="listing" />}
          />
          {revision && <QueuedRevisionBanner queuedAt={revision.createdAt} />}
          <VcForm
            mode="user"
            editingId={id}
            editVersion={row.edit_version}
            initialValues={initialValues}
            reviewOnSave={row.status === "approved"}
          />
        </div>
      </div>
    </AppShell>
  );
}
