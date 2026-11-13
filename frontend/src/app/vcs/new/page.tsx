import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import VcForm from "./VcForm";

export default async function NewVcPage() {
  const { isAdmin, displayName } = await requireApprovedUser();

  return (
    <AppShell active="vcs" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[820px]">
          <PageHead
            className="mb-8"
            context="Suggest a VC or grant"
            title="Share a funding source"
            lede="Submissions go to the admin queue for review before they appear on the Grants & VCs tab."
          />

          <VcForm mode="user" />
        </div>
      </div>
    </AppShell>
  );
}
