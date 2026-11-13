import GraduatesClient from "./GraduatesClient";
import { requireAdminPage } from "@/lib/auth/guard";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

// Default cutoff = last calendar year. The admin can override.
function defaultCutoff(): number {
  return new Date().getFullYear() - 1;
}

export default async function AdminGraduatesPage() {
  await requireAdminPage();
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-[var(--gutter)] pb-24 pt-10 text-text-primary">
      <div className="mx-auto max-w-[820px]">
        <AdminPageHeader
          eyebrow="Admin · graduates"
          title="Ask graduating students to confirm"
          description="Graduates keep their accounts. Each student asked confirms once and, if they've graduated, becomes a recent graduate."
        />

        <GraduatesClient defaultCutoff={defaultCutoff()} />
      </div>
    </main>
  );
}
