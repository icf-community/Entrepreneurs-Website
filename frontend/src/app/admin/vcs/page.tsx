import { listPendingVcs } from "@/lib/data/admin";
import VcsReview from "./VcsReview";
import { requireAdminPage } from "@/lib/auth/guard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";

// bulkApproveVcGrants/bulkRejectVcGrants are one SECURITY DEFINER RPC
// call per id (see runBulk's own comment on why that's sequential, not
// parallel). A genuinely large batch — the exact "worked in batches"
// review pattern this app's own product notes call a normal usage scene,
// not an edge case — can exceed the platform default before the loop
// finishes. Matches the cron routes' own maxDuration override for the
// same reason. Server Actions inherit maxDuration from the invoking
// route, not from the action module, so this has to live here rather
// than in actions.ts.
export const maxDuration = 60;

export default async function AdminVcsPage() {
  const { supabase } = await requireAdminPage();

  const pending = await listPendingVcs(supabase);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-[var(--gutter)] py-10 sm:py-12 text-text-primary">
      <div className="mx-auto max-w-[var(--content-max)]">
        <PageHead
          className="mb-8"
          context="Admin · review queue"
          title="Pending VCs & grants"
          lede={`${pending.length} awaiting review.`}
          actions={
            <>
              <ButtonLink href="/admin/vcs/new" variant="ghost" size="sm" leading={<Icon name="plus" size={18} />}>
                <span className="sr-only">+ </span>New listing
              </ButtonLink>
              <ButtonLink href="/admin" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={18} />}>
                Admin home
              </ButtonLink>
            </>
          }
        />

        <VcsReview items={pending} />
      </div>
    </main>
  );
}
