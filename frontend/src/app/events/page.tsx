import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ListingPageShell from "@/components/ListingPageShell";
import { Skeleton, FilterBarSkeleton, RowListSkeleton } from "@/components/ui/Skeleton";
import { requireApprovedUser } from "@/lib/auth/guard";
import { markedIds } from "@/lib/data/activity";
import { listApprovedEvents, type FoundryEvent } from "@/lib/data/events";
import type { Db } from "@/lib/data/query";
import EventsClient from "./EventsClient";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; e?: string }>;
}) {
  const { supabase, user, isAdmin } = await requireApprovedUser();
  const sp = await searchParams;

  // /events?e=<id> was how a listing was linked to before it had a
  // page of its own. Those links are out in the world — in members'
  // browsers, in whatever they pasted them into — so the param stays, as a
  // redirect to the one canonical address rather than as a second way to
  // read a listing. encodeURIComponent because the id is user input and
  // this builds a path.
  if (sp?.e) redirect(`/events/${encodeURIComponent(sp.e)}`);

  const justSubmitted = sp?.submitted === "1";

  // Started, not awaited — see the note in app/vcs/page.tsx. One query, two
  // awaits, both resolving in the same tick.
  const data = loadEvents(supabase, user.id, isAdmin);

  return (
    <ListingPageShell
      active="events"
      isAdmin={isAdmin}
      justSubmitted={justSubmitted}
      submittedKind="event"
      eyebrow="Events"
      title="Upcoming Foundry events"
      summary={
        <Suspense fallback={<Skeleton className="h-5 w-40" />}>
          <EventCount data={data} />
        </Suspense>
      }
      cta={{ href: "/events/new", label: "Post an event →" }}
    >
      <Suspense
        fallback={
          <>
            <FilterBarSkeleton />
            <RowListSkeleton className="mt-8" />
          </>
        }
      >
        <EventList data={data} />
      </Suspense>
    </ListingPageShell>
  );
}

type EventsData = {
  items: FoundryEvent[];
  goingIds: string[];
};

async function loadEvents(supabase: Db, userId: string, isAdmin: boolean): Promise<EventsData> {
  const [items, goingIds] = await Promise.all([
    listApprovedEvents(supabase, { userId, isAdmin }),
    markedIds(supabase, "event", "going"),
  ]);
  return { items, goingIds };
}

async function EventCount({ data }: { data: Promise<EventsData> }) {
  const { items } = await data;
  return <>{items.length} upcoming event{items.length === 1 ? "" : "s"}.</>;
}

async function EventList({ data }: { data: Promise<EventsData> }) {
  const { items, goingIds } = await data;
  return <EventsClient items={items} goingIds={goingIds} />;
}
