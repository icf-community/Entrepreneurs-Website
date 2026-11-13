import { pageParam } from "@/lib/filters/serverParams";
import { Suspense } from "react";
import { Skeleton, RowListSkeleton } from "@/components/ui/Skeleton";
import { listPendingProfiles, type PendingProfilesPage } from "@/lib/data/admin";
import type { Db } from "@/lib/data/query";
import UsersReview from "./UsersReview";
import { requireAdminPage } from "@/lib/auth/guard";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

// Smaller than /admin/members's 50: each row here is a full review card
// with bio, what they're working on, and their links — the heaviest
// per-row shape in the app.
const PAGE_SIZE = 25;

// approveUser/rejectUser's bulk variants are one SECURITY DEFINER RPC call
// per id (see runBulk's own comment on why that's sequential, not
// parallel). A genuinely large batch — the exact "worked in batches"
// review pattern this app's own product notes call a normal usage scene,
// not an edge case — can exceed the platform default before the loop
// finishes. Matches the cron routes' own maxDuration override for the
// same reason. Server Actions inherit maxDuration from the invoking
// route, not from the action module, so this has to live here rather
// than in actions.ts.
export const maxDuration = 60;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { supabase } = await requireAdminPage();
  const page = pageParam((await searchParams).page);

  // Started, not awaited: the header renders while the query is in flight.
  const data = loadPending(supabase, page);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-[var(--gutter)] pb-24 pt-10 text-text-primary">
      <div className="mx-auto max-w-[var(--content-max)]">
        {/* The count streams in beside the header; PageHead takes a block lede
            when it is not a plain sentence, so the skeleton <div> is safe here. */}
        <AdminPageHeader
          eyebrow="Admin · review queue"
          title="Pending alumni profiles"
          description={
            <Suspense fallback={<Skeleton className="h-3 w-32" />}>
              <PendingCount data={data} />
            </Suspense>
          }
        />

        <Suspense fallback={<RowListSkeleton count={4} />}>
          <Queue data={data} page={page} />
        </Suspense>
      </div>
    </main>
  );
}

async function loadPending(supabase: Db, page: number): Promise<PendingProfilesPage> {
  return listPendingProfiles(supabase, {
    limit:  PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
}

// A lit point only while something is waiting: the queue's one signal.
async function PendingCount({ data }: { data: Promise<PendingProfilesPage> }) {
  const { total } = await data;
  return (
    <span className="inline-flex items-center gap-2">
      {total > 0 && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-lit" />}
      {total} awaiting review.
    </span>
  );
}

async function Queue({ data, page }: { data: Promise<PendingProfilesPage>; page: number }) {
  const { items, total } = await data;

  // Rendered unconditionally, empty queue included: the empty state belongs
  // inside BulkReview so that approving or rejecting the LAST batch doesn't
  // unmount the component holding its own confirmation. See BulkReview's
  // emptyMessage prop.
  return (
    <UsersReview
      items={items}
      page={page}
      total={total}
      pageSize={PAGE_SIZE}
      emptyMessage={total === 0 ? "Nothing pending. The queue is clear." : "No profiles on this page."}
    />
  );
}
