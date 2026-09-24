import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Skeleton, RowListSkeleton } from "@/components/ui/Skeleton";
import { listPendingProfiles, type PendingProfilesPage } from "@/lib/data/admin";
import type { Db } from "@/lib/data/query";
import UsersReview from "./UsersReview";

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
  const supabase = await createClient();
  const parsed = Number.parseInt((await searchParams).page ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  // Started, not awaited: the header renders while the query is in flight.
  const data = loadPending(supabase, page);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin · review queue</p>
            <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">
              Pending alumni profiles
            </h1>
            <p className="text-[0.85rem] text-text-muted mt-2">
              <Suspense fallback={<Skeleton className="h-3 w-32 inline-block align-middle" />}>
                <PendingCount data={data} />
              </Suspense>
            </p>
          </div>
          <Link
            href="/admin"
            className="text-[0.8rem] text-text-secondary no-underline transition-colors duration-150 hover:text-text-primary"
          >
            ← Admin home
          </Link>
        </div>

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

async function PendingCount({ data }: { data: Promise<PendingProfilesPage> }) {
  const { total } = await data;
  return <>{total} awaiting review.</>;
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
