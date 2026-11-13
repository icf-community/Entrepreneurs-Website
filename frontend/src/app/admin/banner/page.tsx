import { maybeRow } from "@/lib/data/query";
import BannerForm from "./BannerForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

// ════════════════════════════════════════════════════════════════════
// Foundry · /admin/banner (launch programme F-x4)
//
// Where any admin puts one message in front of every member: an outage,
// slow sign-in, planned maintenance. The admin layout above has already
// 404'd non-admins; admin_get_site_banner checks again.
// ════════════════════════════════════════════════════════════════════

export const metadata = { title: "Site banner" };

export default async function AdminBannerPage() {
  const { supabase } = await requireAdminPage();
  const current = await maybeRow("admin_get_site_banner", () =>
    supabase.rpc("admin_get_site_banner").maybeSingle(),
  );

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-[var(--gutter)] pb-24 pt-10 text-text-primary">
      <div className="mx-auto max-w-[760px]">
        <AdminPageHeader
          eyebrow="Admin"
          title="Site banner"
          description="One message shown across the site, including the sign-in page. Use it when something is broken or slow."
        />

        <BannerForm
          current={
            current
              ? {
                  message: current.message,
                  severity: current.severity as "info" | "warning" | "critical",
                  linkUrl: current.link_url ?? "",
                  hideAfter: current.hide_after,
                  enabled: current.enabled,
                  updatedAt: current.updated_at,
                  updatedByName: current.updated_by_name,
                }
              : null
          }
        />
      </div>
    </main>
  );
}
