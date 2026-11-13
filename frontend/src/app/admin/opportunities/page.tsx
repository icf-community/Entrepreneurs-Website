import Link from "next/link";
import { listPendingOpportunities } from "@/lib/data/admin";
import OpportunitiesReview from "./OpportunitiesReview";
import { requireAdminPage } from "@/lib/auth/guard";

// bulkApproveOpportunities/bulkRejectOpportunities are one SECURITY
// DEFINER RPC call per id (see runBulk's own comment on why that's
// sequential, not parallel). A genuinely large batch — the exact "worked
// in batches" review pattern this app's own product notes call a normal
// usage scene, not an edge case — can exceed the platform default before
// the loop finishes. Matches the cron routes' own maxDuration override
// for the same reason. Server Actions inherit maxDuration from the
// invoking route, not from the action module, so this has to live here
// rather than in actions.ts.
export const maxDuration = 60;

export default async function AdminOpportunitiesPage() {
  const { supabase } = await requireAdminPage();

  const pending = await listPendingOpportunities(supabase);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin · review queue</p>
            <h1 className="font-display text-display leading-[1.1] tracking-tight">
              Pending opportunities
            </h1>
            <p className="text-body text-text-muted mt-2">
              {pending.length} awaiting review.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/admin/opportunities/new" className="px-3 py-1.5 rounded-lg bg-accent text-bg-primary text-body font-medium no-underline transition-colors hover:bg-accent-light">
              + New opportunity
            </Link>
            <Link href="/admin" className="text-body text-text-secondary no-underline transition-colors duration-150 hover:text-text-primary">
              ← Admin home
            </Link>
          </div>
        </div>

        <OpportunitiesReview items={pending} />
      </div>
    </main>
  );
}
