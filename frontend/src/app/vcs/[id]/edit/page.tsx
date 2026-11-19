import type { Metadata } from "next";
import { isUuid } from "@/lib/uuid";
import { notFound } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { listingEditSnapshot } from "@/lib/listings/editSnapshot";
import VcForm, { type VcInitialValues } from "../../new/VcForm";
import { EditStatusNote, QueuedRevisionBanner } from "@/components/forms/EditStatusNote";
import { Page } from "@/components/ui/Page";
import { Trail } from "@/components/ui/Trail";

export const metadata: Metadata = { title: "Edit VC or grant" };

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
      <Page width="page">
        <PageHead
          className="mb-8"
          context={<Trail href="/my-submissions" label="Your submissions" current={<>Edit {row.kind === "vc" ? "VC" : "grant"}</>} />}
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
      </Page>
    </AppShell>
  );
}
