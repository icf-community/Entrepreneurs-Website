import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ListingPageShell from "@/components/ListingPageShell";
import { Skeleton, FilterBarSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";
import { requireApprovedUser } from "@/lib/auth/guard";
import { markedIds } from "@/lib/data/activity";
import {
  listApprovedOpportunities,
  bookmarkedOpportunityIds,
  myEducation,
  type Opportunity,
} from "@/lib/data/opportunities";
import { EducationForm } from "@/components/forms/EducationForm";
import type { Db } from "@/lib/data/query";
import { aiModeEnabled } from "@/lib/ai/data";
import OpportunitiesClient from "./OpportunitiesClient";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; o?: string }>;
}) {
  const { supabase, user, isAdmin } = await requireApprovedUser();
  const sp = await searchParams;

  // /opportunities?o=<id> was how a listing was linked to before it had a
  // page of its own. Those links are out in the world — in members'
  // browsers, in whatever they pasted them into — so the param stays, as a
  // redirect to the one canonical address rather than as a second way to
  // read a listing. encodeURIComponent because the id is user input and
  // this builds a path.
  if (sp?.o) redirect(`/opportunities/${encodeURIComponent(sp.o)}`);

  const justSubmitted = sp?.submitted === "1";

  // Started, not awaited — see the note in app/vcs/page.tsx.
  const data = loadOpportunities(supabase, user.id);
  const aiEnabled = aiModeEnabled(supabase, "opportunities");
  // Jobs are for students, graduates or both (AI-plan §7.2). Until a member
  // says which they are, they see none, so ask rather than show an empty
  // board (F29). Admins see every job anyway.
  const education = isAdmin ? null : await myEducation(supabase);

  return (
    <ListingPageShell
      active="opportunities"
      isAdmin={isAdmin}
      justSubmitted={justSubmitted}
      submittedKind="opportunity"
      eyebrow="Opportunities"
      title="Roles from the Foundry network"
      summary={
        <Suspense fallback={<Skeleton className="h-3 w-36" />}>
          <OpportunityCount data={data} />
        </Suspense>
      }
      cta={{ href: "/opportunities/new", label: "Post an opportunity →" }}
      actions={
        <Suspense fallback={<Skeleton className="h-3 w-28" />}>
          <BookmarksLink data={data} />
        </Suspense>
      }
    >
      {education && !education.known && (
        <section className="mb-8 rounded-2xl border border-border bg-bg-card p-6" aria-labelledby="confirm-status">
          <h2 id="confirm-status" className="text-[0.95rem] font-medium text-text-primary">Confirm your status to see jobs</h2>
          <p className="mt-1 mb-4 text-[0.8rem] text-text-muted">Each job is for students, graduates or both.</p>
          <EducationForm initialEnrolled={null} initialGraduated={null} compact />
        </section>
      )}
      <Suspense
        fallback={
          <>
            <FilterBarSkeleton />
            <RowListSkeleton className="mt-8" />
          </>
        }
      >
        <OpportunityList data={data} aiEnabled={aiEnabled} />
      </Suspense>
    </ListingPageShell>
  );
}

type OpportunitiesData = {
  items: Opportunity[];
  bookmarkedIds: string[];
  appliedIds: string[];
};

async function loadOpportunities(supabase: Db, userId: string): Promise<OpportunitiesData> {
  const [items, bookmarkedIds, appliedIds] = await Promise.all([
    listApprovedOpportunities(supabase),
    bookmarkedOpportunityIds(supabase, userId),
    markedIds(supabase, "opportunity", "applied"),
  ]);
  return { items, bookmarkedIds, appliedIds };
}

async function OpportunityCount({ data }: { data: Promise<OpportunitiesData> }) {
  const { items } = await data;
  return <>{items.length} open role{items.length === 1 ? "" : "s"}.</>;
}

async function BookmarksLink({ data }: { data: Promise<OpportunitiesData> }) {
  const { bookmarkedIds } = await data;
  return (
    <Link
      href="/my-bookmarks"
      className="text-[0.8rem] text-text-secondary no-underline transition-colors duration-150 hover:text-accent-light flex items-center gap-1.5"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      Your bookmarks{bookmarkedIds.length > 0 ? ` (${bookmarkedIds.length})` : ""}
    </Link>
  );
}

async function OpportunityList({ data, aiEnabled }: { data: Promise<OpportunitiesData>; aiEnabled: Promise<boolean> }) {
  const [{ items, bookmarkedIds, appliedIds }, enabled] = await Promise.all([data, aiEnabled]);
  return (
    <OpportunitiesClient
      items={items}
      bookmarkedIds={bookmarkedIds}
      appliedIds={appliedIds}
      aiEnabled={enabled}
    />
  );
}
