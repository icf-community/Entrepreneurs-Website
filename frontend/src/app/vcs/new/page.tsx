import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import VcForm from "./VcForm";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Suggest a VC or grant" };

export default async function NewVcPage() {
  const { isAdmin, displayName } = await requireApprovedUser();

  return (
    <AppShell active="vcs" name={displayName} isAdmin={isAdmin}>
      <Page width="page">
        <PageHead
          className="mb-8"
          context="Suggest a VC or grant"
          title="Share a funding source"
          lede="Submissions go to the admin queue for review before they appear on the Grants & VCs tab."
        />

        <VcForm mode="user" />
      </Page>
    </AppShell>
  );
}
