import Link from "next/link";
import { maybeRow, rowsOrThrow } from "@/lib/data/query";
import { requireAdminPage } from "@/lib/auth/guard";
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
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-4 sm:px-8 py-12">
      <div className="max-w-[960px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin</p>
            <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">AI</h1>
            <p className="text-[0.85rem] text-text-muted mt-2 max-w-[60ch] leading-relaxed">
              Health and limits for Foundry AI. Totals only; nothing here shows a member&apos;s searches.
            </p>
          </div>
          <Link href="/admin" className="text-[0.8rem] rounded-lg border border-border-strong bg-white/[0.05] px-4 py-1.5 text-text-primary no-underline hover:border-accent">
            ← Admin home
          </Link>
        </div>
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
