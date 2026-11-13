import { maybeRow, rowsOrThrow } from "@/lib/data/query";
import { requireAdminPage } from "@/lib/auth/guard";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import AiAdminClient, { type AiOverview } from "./AiAdminClient";

// ════════════════════════════════════════════════════════════════════
// Foundry · /admin/ai (AI-plan §10.1)
//
// Aggregate AI health for every admin: switches, limits, today's spend,
// queue, outcomes, latency, how many members have opted in. Nothing
// per-member, no messages, no candidate lists. Changing a switch or a
// limit is an AI-operator action, checked inside the RPC and logged with
// its reason. Also the queue of approved jobs that still need an audience.
// ════════════════════════════════════════════════════════════════════

export const metadata = { title: "AI" };
export const dynamic = "force-dynamic";

export default async function AdminAiPage() {
  const { supabase } = await requireAdminPage();
  const [overview, needingAudience] = await Promise.all([
    maybeRow("admin_ai_overview", () => supabase.rpc("admin_ai_overview")),
    rowsOrThrow("admin_list_opportunities_needing_audience", () =>
      supabase.rpc("admin_list_opportunities_needing_audience")),
  ]);
  if (!overview) throw new Error("Failed to load admin_ai_overview");

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-[var(--gutter)] pb-24 pt-10 text-text-primary">
      <div className="mx-auto max-w-[960px]">
        <AdminPageHeader
          eyebrow="Admin"
          title="AI"
          description="Health and limits for Foundry AI. Totals only; nothing here shows a member's searches."
        />
        <AiAdminClient
          overview={overview as unknown as AiOverview}
          needingAudience={needingAudience.map((o) => ({
            id: o.id,
            title: o.position_name,
            company: o.company,
            deadline: o.application_deadline,
            poster: `${o.poster_first_name ?? ""} ${o.poster_surname ?? ""}`.trim(),
          }))}
        />
      </div>
    </main>
  );
}
