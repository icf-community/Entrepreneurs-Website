import Link from "next/link";
import { Suspense } from "react";
import AppShell from "@/components/app/AppShell";
import { IntakePromptCard } from "@/components/app/IntakePromptCard";
import NewestMembers from "@/components/members/NewestMembers";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { Entry } from "@/components/ui/Entry";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";
import { requireApprovedUser } from "@/lib/auth/guard";
import { GraduationPrompt } from "./GraduationPrompt";
import { myPendingConnectionCount } from "@/lib/data/connections";
import { newestMembers } from "@/lib/data/directory";
import { newestEvents } from "@/lib/data/events";
import { newestOpportunities } from "@/lib/data/opportunities";
import { newestVcs } from "@/lib/data/vcs";
import { formatDate, formatDateTime } from "@/lib/dates";

// ════════════════════════════════════════════════════════════════════
// Foundry · Home
//
// The landing surface behind auth: who has just joined, and the three
// most recently added listings of each kind, each with a way through to
// the full page.
//
// "Most recently added" is created_at, not the event date or the
// deadline — those are what the listing pages sort by, and repeating
// them here would make /home a shorter copy of /events rather than a
// digest of what is new. The underlying RPCs still drop past events and
// expired roles, so nothing dead surfaces.
//
// Every card links to that listing's own page — /events/<id>,
// /opportunities/<id>, /vcs/<id>. Those routes did not exist when this
// screen was written: the cards pointed at them anyway and 404ed, then
// pointed at the list pages with a ?e=/?o=/?v= param that opened the card
// in place. The param survives as a redirect to these routes, so links
// shared during that window still land in the right place.
//
// The prototype's "Connection requests" block is now here, and it
// follows the same rule as everything else on this screen: it renders
// only when it has something to say. Zero pending requests is the normal
// state for most members most of the time, and a permanent empty card
// teaches people that this screen is decoration. The table it reads is
// `connections` (20260917000001), not the `intro_requests` this comment
// used to name.
//
// The drawing is one hierarchy, not three equal rows: people first (a ring each),
// then the events, the newest of them given the room, then the opportunities
// and the funding side by side as two quiet lists. The one lit thing is the
// connection request, when there is one.
// ════════════════════════════════════════════════════════════════════

export default async function HomePage() {
  const { supabase, user, isAdmin } = await requireApprovedUser({ bounceToIntake: true });

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, surname, preferred_name, profile_version, role, graduation_prompted_at, graduation_confirmed_at")
    .eq("id", user.id)
    .single();

  const name =
    profile?.preferred_name?.trim() || profile?.first_name?.trim() || "there";
  const fullName = [profile?.first_name, profile?.surname].filter(Boolean).join(" ");
  // requireApprovedUser({ bounceToIntake: true }) already redirected anyone
  // who has never seen /intake — reaching this line at profile_version < 2
  // means the member deferred it at least once, so this is a reminder, not
  // a first invitation. Admins never get the bounce, so they see this too,
  // which is fine — it's inert for them either way.
  const showIntakePrompt = (profile?.profile_version ?? 2) < 2;
  // An admin asked this student to confirm graduation (20261011000005).
  const showGraduationPrompt =
    profile?.role === "student" && !!profile?.graduation_prompted_at && !profile?.graduation_confirmed_at;

  // Started, not awaited — the four sections resolve in the same tick.
  const members = newestMembers(supabase, 5, { isAdmin });
  const events = newestEvents(supabase);
  const opps = newestOpportunities(supabase);
  const vcs = newestVcs(supabase);
  // One index-only scan on the partial pending index. Awaited rather than
  // streamed because it decides whether a whole section exists, and a
  // section that pops in after the page has settled is worse than one
  // that costs a sub-millisecond query to place correctly.
  const pendingConnections = await myPendingConnectionCount(supabase);

  const hasPrompts = showGraduationPrompt || showIntakePrompt || pendingConnections > 0;

  return (
    <AppShell active="home" name={fullName || name}>
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHead context="Hello," title={name} className="mb-8" />

          <div className="lm-sections">
            {hasPrompts && (
              // What is waiting on the member personally, kept together. Every card in it
              // draws its own bottom margin (the intake prompt is the shell's), so the grid
              // gap is the only spacing between them.
              <div className="grid gap-4 [&>*]:mb-0">
                {showGraduationPrompt && <GraduationPrompt currentYear={new Date().getFullYear()} />}
                {showIntakePrompt && <IntakePromptCard />}
                {pendingConnections > 0 && <ConnectionRequestsCard count={pendingConnections} />}
              </div>
            )}

            <Suspense fallback={<StripSkeleton />}>
              <Newest data={members} />
            </Suspense>

            <Section
              title="Events"
              description="Foundry gatherings and member meetups"
              actions={<ViewAll href="/events" label="Events" />}
            >
              <Suspense fallback={<EventsSkeleton />}>
                <Events data={events} />
              </Suspense>
            </Section>

            <div className="grid gap-[var(--section-gap)] lg:grid-cols-2 lg:gap-x-10">
              <Section
                title="Opportunities"
                description="Roles, projects and introductions shared by members"
                actions={<ViewAll href="/opportunities" label="Opportunities" />}
              >
                <Suspense fallback={<RowsSkeleton />}>
                  <Opportunities data={opps} />
                </Suspense>
              </Section>

              <Section
                title="VCs and Grants"
                description="Funding routes open to Foundry founders"
                actions={<ViewAll href="/vcs" label="VCs and Grants" />}
              >
                <Suspense fallback={<RowsSkeleton />}>
                  <Vcs data={vcs} />
                </Suspense>
              </Section>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * The one thing on this page that is waiting on the member personally, so the one
 * thing that is lit.
 *
 * It says nothing about who is waiting. The names are one click away on
 * /connections, and putting them here would spread a private, one-to-one
 * interaction onto the screen a member might open with somebody looking
 * over their shoulder.
 */
function ConnectionRequestsCard({ count }: { count: number }) {
  return (
    <Panel as="section" tone="lit" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 p-5 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Disc lit>
          <Icon name="connections" size={20} />
        </Disc>
        <div className="min-w-0">
          <p className="font-display text-lead text-text-primary">
            {count === 1
              ? "Someone wants to connect with you"
              : `${count} people want to connect with you`}
          </p>
          <p className="mt-0.5 text-small text-text-secondary">
            Accepting means you each see the other&apos;s email address.
          </p>
        </div>
      </div>
      <ButtonLink href="/connections?tab=pending" size="md">
        Review {count === 1 ? "it" : "them"}
        <Icon name="arrow-right" size={16} />
      </ButtonLink>
    </Panel>
  );
}

/** The way through to the full listing: a quiet control at the head of its section. */
function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <ButtonLink href={href} variant="ghost" size="sm">
      View all {label}
      <Icon name="arrow-right" size={16} />
    </ButtonLink>
  );
}

function StripSkeleton() {
  return (
    <SkeletonRegion label="Loading newest members…" className="grid gap-5">
      <Skeleton className="h-7 w-72 max-w-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Panel key={i} className="grid justify-items-center gap-3 px-3 pb-5 pt-6">
            <Skeleton shape="ring" className="size-24" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </Panel>
        ))}
      </div>
    </SkeletonRegion>
  );
}

function EventsSkeleton() {
  return (
    <SkeletonRegion label="Loading events…" className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Skeleton className="h-48 w-full rounded-xl lg:row-span-2 lg:h-full" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </SkeletonRegion>
  );
}

function RowsSkeleton() {
  return (
    <SkeletonRegion label="Loading…">
      <Panel className="grid gap-1 p-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton shape="ring" className="size-11 shrink-0" />
            <div className="grid flex-1 gap-2.5">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        ))}
      </Panel>
    </SkeletonRegion>
  );
}

async function Newest({ data }: { data: ReturnType<typeof newestMembers> }) {
  const newest = await data;
  // C4: an empty strip used to render nothing at all, which on a quiet
  // week read as a gap in the page.
  if (newest.length === 0) {
    return (
      <EmptyState icon="members" size="compact">
        New members will appear here as they join.
      </EmptyState>
    );
  }
  return <NewestMembers newest={newest} />;
}

async function Events({ data }: { data: ReturnType<typeof newestEvents> }) {
  const latest = await data;
  if (latest.length === 0) {
    return (
      <EmptyState icon="events" size="compact">
        Nothing scheduled yet. Post the first one from the Events page.
      </EmptyState>
    );
  }
  return (
    // One list, so every card stays a link inside a list item. The newest event is given the room.
    <ul className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {latest.map((e, i) =>
        i === 0 ? (
          <li key={e.id} className="lg:row-span-2">
            <Panel interactive className="relative flex h-full min-h-44 flex-col justify-between gap-8 p-6 sm:p-7">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Disc size="sm">
                    <Icon name="events" size={18} />
                  </Disc>
                  {e.isSocietyEvent && <Badge tone="lit">Society event</Badge>}
                </div>
                <p className="data text-small text-text-muted">{formatDateTime(e.eventAt)}</p>
                <Link
                  href={`/events/${e.id}`}
                  className="font-display text-title text-text-primary no-underline after:absolute after:inset-0 after:content-['']"
                >
                  {e.title}
                </Link>
              </div>
              {e.location ? (
                <p className="flex items-center gap-2 text-body text-text-secondary">
                  <Icon name="pin" size={16} className="shrink-0 text-text-muted" />
                  {e.location}
                </p>
              ) : null}
            </Panel>
          </li>
        ) : (
          <li key={e.id}>
            <Panel className="h-full p-1.5">
              <Entry
                glyph={<Icon name="events" size={20} />}
                title={e.title}
                href={`/events/${e.id}`}
                meta={<span className="data">{formatDateTime(e.eventAt)}</span>}
                trailing={e.isSocietyEvent ? <Badge tone="lit">Society event</Badge> : undefined}
              >
                {e.location ? <p className="mt-0.5 text-small text-text-muted">{e.location}</p> : null}
              </Entry>
            </Panel>
          </li>
        ),
      )}
    </ul>
  );
}

async function Opportunities({ data }: { data: ReturnType<typeof newestOpportunities> }) {
  const latest = await data;
  if (latest.length === 0) {
    return (
      <EmptyState icon="opportunities" size="compact">
        No open opportunities right now. Post one from the Opportunities page.
      </EmptyState>
    );
  }
  return (
    <Panel className="p-1.5">
      <ul className="grid gap-0.5">
        {latest.map((o) => (
          <Entry
            key={o.id}
            as="li"
            glyph={<Icon name="opportunities" size={20} />}
            title={o.positionName}
            href={`/opportunities/${o.id}`}
            meta={o.company}
          >
            <p className="mt-0.5 text-small text-text-muted">
              <span className="capitalize">{o.locationType}</span>
              {o.locationText ? ` · ${o.locationText}` : ""}
            </p>
          </Entry>
        ))}
      </ul>
    </Panel>
  );
}

async function Vcs({ data }: { data: ReturnType<typeof newestVcs> }) {
  const latest = await data;
  if (latest.length === 0) {
    return (
      <EmptyState icon="vcs" size="compact">
        No VCs or grants listed yet. Suggest one from the Grants &amp; VCs page.
      </EmptyState>
    );
  }
  return (
    <Panel className="p-1.5">
      <ul className="grid gap-0.5">
        {latest.map((v) => (
          <Entry
            key={v.id}
            as="li"
            glyph={<Icon name="vcs" size={20} />}
            title={v.name}
            href={`/vcs/${v.id}`}
            meta={v.amount ?? (v.deadline ? `Closes ${formatDate(v.deadline)}` : "Rolling applications")}
          >
            <p className="mt-0.5 text-small text-text-muted">
              {v.kind === "vc" ? "VC" : "Grant"}
              {v.stage ? ` · ${v.stage}` : ""}
            </p>
          </Entry>
        ))}
      </ul>
    </Panel>
  );
}
