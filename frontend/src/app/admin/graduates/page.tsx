import GraduatesClient from "./GraduatesClient";
import { requireAdminPage } from "@/lib/auth/guard";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Page } from "@/components/ui/Page";

// Default cutoff = last calendar year. The admin can override.
function defaultCutoff(): number {
  return new Date().getFullYear() - 1;
}

export default async function AdminGraduatesPage() {
  await requireAdminPage();
  return (
    <Page width="page" as="main">
      <AdminPageHeader
        eyebrow="Admin · graduates"
        title="Ask graduating students to confirm"
        description="Graduates keep their accounts. Each student asked confirms once and, if they've graduated, becomes a recent graduate."
      />

      <GraduatesClient defaultCutoff={defaultCutoff()} />
    </Page>
  );
}
