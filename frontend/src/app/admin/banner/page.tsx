import Link from "next/link";
import { maybeRow } from "@/lib/data/query";
import BannerForm from "./BannerForm";
import { requireAdminPage } from "@/lib/auth/guard";

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
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[760px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin</p>
            <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">
              Site banner
            </h1>
            <p className="text-[0.85rem] text-text-muted mt-2 max-w-[60ch] leading-relaxed">
              One message shown across the site, including the sign-in page. Use it when
              something is broken or slow.
            </p>
          </div>
          <Link
            href="/admin"
            className="text-[0.8rem] rounded-lg border border-border-strong bg-white/[0.05] px-4 py-1.5 text-text-primary no-underline hover:border-accent"
          >
            ← Admin home
          </Link>
        </div>

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
