import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import VcForm from "./VcForm";

export default async function NewVcPage() {
  const { isAdmin, displayName } = await requireApprovedUser();

  return (
    <AppShell active="vcs" name={displayName} isAdmin={isAdmin}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[720px] mx-auto">
          <div className="mb-8 rule-draw pt-6">
            <p className="label-wide text-text-secondary mb-3">Suggest a VC or grant</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-display">
              Share a funding source
            </h1>
            <p className="text-body text-text-muted mt-3 leading-relaxed">
              Submissions go to the admin queue for review before they appear on the Grants & VCs tab.
            </p>
          </div>

          <VcForm mode="user" />
        </div>
      </div>
    </AppShell>
  );
}
