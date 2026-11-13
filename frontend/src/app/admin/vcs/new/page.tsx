import Link from "next/link";
import VcForm from "@/app/vcs/new/VcForm";
import { requireAdminPage } from "@/lib/auth/guard";

export default async function AdminNewVcPage() {
  await requireAdminPage();
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[720px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin · direct publish</p>
            <h1 className="font-display text-display leading-[1.1] tracking-tight">
              New VC / grant
            </h1>
            <p className="text-body text-text-muted mt-2">
              Skips the approval queue — published immediately.
            </p>
          </div>
          <Link href="/admin/vcs" className="text-body text-text-secondary no-underline hover:text-text-primary">
            ← Back to queue
          </Link>
        </div>

        <VcForm mode="admin" />
      </div>
    </main>
  );
}
