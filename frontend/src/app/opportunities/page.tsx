import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ListingPageShell from "@/components/ListingPageShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Panel } from "@/components/ui/Panel";
import { Skeleton, FilterBarSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/design-system/icons/Icon";
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

export const metadata: Metadata = { title: "Opportunities" };

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
  const data = loadOpportunities(supabase, user.id, isAdmin);
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
        <Suspense fallback={<Skeleton className="h-5 w-36" />}>
          <OpportunityCount data={data} />
        </Suspense>
      }
      cta={{ href: "/opportunities/new", label: "Post an opportunity →" }}
      actions={
        <Suspense fallback={<Skeleton className="h-11 w-44 rounded-full" />}>
          <BookmarksLink data={data} />
        </Suspense>
      }
    >
      {education && !education.known && (
        <Panel as="section" className="mb-8 p-5 sm:p-6" aria-labelledby="confirm-status">
          <h2 id="confirm-status" className="font-display text-title text-text-primary">Confirm your status to see jobs</h2>
          <p className="mb-5 mt-1.5 text-body text-text-secondary">Each job is for students, graduates or both.</p>
          <EducationForm initialEnrolled={null} initialGraduated={null} compact />
        </Panel>
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

async function loadOpportunities(supabase: Db, userId: string, isAdmin: boolean): Promise<OpportunitiesData> {
  const [items, bookmarkedIds, appliedIds] = await Promise.all([
    listApprovedOpportunities(supabase, { userId, isAdmin }),
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
    <ButtonLink href="/my-bookmarks" variant="ghost" size="md" leading={<Icon name="bookmark" size={18} />}>
      Your bookmarks{bookmarkedIds.length > 0 ? ` (${bookmarkedIds.length})` : ""}
    </ButtonLink>
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
