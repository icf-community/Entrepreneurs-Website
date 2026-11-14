import type { Metadata } from "next";
import { flattenSearchParams, pageParam, isoDayParam } from "@/lib/filters/serverParams";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ListingPageShell from "@/components/ListingPageShell";
import { Skeleton, FilterBarSkeleton, CardGridSkeleton } from "@/components/ui/Skeleton";
import { requireApprovedUser } from "@/lib/auth/guard";
import { markedIds } from "@/lib/data/activity";
import { listApprovedVcs, VC_PAGE_SIZE, type Vc, type VcFilters } from "@/lib/data/vcs";
import type { Db } from "@/lib/data/query";
import VcsClient from "./VcsClient";

export const metadata: Metadata = { title: "Grants & VCs" };

type SearchParams = {
  submitted?: string; v?: string;
  q?: string; kind?: string; from?: string; to?: string; page?: string;
};

function parseFilters(sp: SearchParams): VcFilters {
  return {
    q: sp.q ?? "",
    kind: sp.kind === "vc" || sp.kind === "grant" ? sp.kind : "all",
    // Dates and the page number are checked here: a malformed one used to
    // reach Postgres, fail there and come back as an empty list plus a
    // logged error.
    from: isoDayParam(sp.from),
    to: isoDayParam(sp.to),
    page: pageParam(sp.page),
  };
}

export default async function VcsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { supabase, isAdmin } = await requireApprovedUser();
  const sp = flattenSearchParams(await searchParams, []);

  // /vcs?v=<id> was how a listing was linked to before it had a
  // page of its own. Those links are out in the world — in members'
  // browsers, in whatever they pasted them into — so the param stays, as a
  // redirect to the one canonical address rather than as a second way to
  // read a listing. encodeURIComponent because the id is user input and
  // this builds a path.
  if (sp?.v) redirect(`/vcs/${encodeURIComponent(sp.v)}`);

  const justSubmitted = sp?.submitted === "1";
  const filters = parseFilters(sp);

  // Started here but deliberately not awaited: the page returns immediately
  // so the nav and page header reach the browser while the query is still
  // running. Both consumers below await the *same* promise, so it stays one
  // query, and they resolve in the same tick — the count and the list swap
  // in together rather than flickering one after the other.
  const data = loadVcs(supabase, filters, isAdmin);

  return (
    <ListingPageShell
      active="vcs"
      isAdmin={isAdmin}
      justSubmitted={justSubmitted}
      submittedKind="VC/grant"
      eyebrow="Grants & VCs"
      title="Funding for Foundry founders"
      summary={
        <Suspense fallback={<Skeleton className="h-5 w-36" />}>
          <VcCount data={data} />
        </Suspense>
      }
      cta={{ href: "/vcs/new", label: "Suggest a VC or grant →" }}
    >
      <Suspense
        fallback={
          <>
            <FilterBarSkeleton />
            <CardGridSkeleton className="mt-8" />
          </>
        }
      >
        <VcList data={data} filters={filters} />
      </Suspense>
    </ListingPageShell>
  );
}

type VcsData = {
  items: Vc[];
  matching: number;
  appliedIds: string[];
};

async function loadVcs(supabase: Db, filters: VcFilters, isAdmin: boolean): Promise<VcsData> {
  // The listing rows are filtered/paged live; get_my_listing_actions is
  // per-user by definition and is always read live too. See lib/data/vcs.ts.
  const [{ items, matching }, appliedIds] = await Promise.all([
    listApprovedVcs(supabase, filters, { isAdmin }),
    markedIds(supabase, "vc_grant", "applied"),
  ]);
  return { items, matching, appliedIds };
}

async function VcCount({ data }: { data: Promise<VcsData> }) {
  const { matching } = await data;
  return <>{matching} active listing{matching === 1 ? "" : "s"}.</>;
}

async function VcList({ data, filters }: { data: Promise<VcsData>; filters: VcFilters }) {
  const { items, matching, appliedIds } = await data;
  return (
    <VcsClient
      items={items}
      matching={matching}
      filters={filters}
      pageSize={VC_PAGE_SIZE}
      appliedIds={appliedIds}
    />
  );
}
