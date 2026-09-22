import Link from "next/link";
import { Suspense } from "react";
import AppShell from "@/components/app/AppShell";
import { IntakePromptCard } from "@/components/app/IntakePromptCard";
import NewestMembers from "@/components/members/NewestMembers";
import { Skeleton } from "@/components/ui/Skeleton";
import { requireApprovedUser } from "@/lib/auth/guard";
import { myPendingConnectionCount } from "@/lib/data/connections";
import { newestMembers } from "@/lib/data/directory";
import { listApprovedEvents } from "@/lib/data/events";
import { listApprovedOpportunities } from "@/lib/data/opportunities";
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
// ════════════════════════════════════════════════════════════════════

/** Most recently added first. Ties keep their incoming order. */
function newestFirst<T extends { createdAt: string }>(items: T[], n: number): T[] {
  return [...items]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, n);
}

export default async function HomePage() {
  const { supabase, user } = await requireApprovedUser({ bounceToIntake: true });

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, surname, preferred_name, profile_version")
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

  // Started, not awaited — the four sections resolve in the same tick.
  const members = newestMembers(supabase);
  const events = listApprovedEvents(supabase);
  const opps = listApprovedOpportunities(supabase);
  const vcs = newestVcs(supabase);
  // One index-only scan on the partial pending index. Awaited rather than
  // streamed because it decides whether a whole section exists, and a
  // section that pops in after the page has settled is worse than one
  // that costs a sub-millisecond query to place correctly.
  const pendingConnections = await myPendingConnectionCount(supabase);

  return (
    <AppShell active="home" name={fullName || name}>
      <div className="mx-auto w-full max-w-[1100px] px-6 py-10 sm:px-10">
        <header className="mb-12">
          <p className="mb-1 text-[0.8rem] text-text-muted">Hello,</p>
          <h1 className="font-display text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] tracking-tight text-text-primary">
            {name}
          </h1>
        </header>

        {showIntakePrompt && <IntakePromptCard />}

        {pendingConnections > 0 && <ConnectionRequestsCard count={pendingConnections} />}

        <Suspense fallback={<StripSkeleton />}>
          <Newest data={members} />
        </Suspense>

        <Section title="Events" blurb="Foundry gatherings and member meetups">
          <Suspense fallback={<CardsSkeleton />}>
            <Events data={events} />
          </Suspense>
          <ViewAll href="/events" label="Events" />
        </Section>

        <Section
          title="Opportunities"
          blurb="Roles, projects and introductions shared by members"
        >
          <Suspense fallback={<CardsSkeleton />}>
            <Opportunities data={opps} />
          </Suspense>
          <ViewAll href="/opportunities" label="Opportunities" />
        </Section>

        <Section title="VCs and Grants" blurb="Funding routes open to Foundry founders">
          <Suspense fallback={<CardsSkeleton />}>
            <Vcs data={vcs} />
          </Suspense>
          <ViewAll href="/vcs" label="VCs and Grants" />
        </Section>
      </div>
    </AppShell>
  );
}

/**
 * The one thing on this page that is waiting on the member personally.
 *
 * It says nothing about who is waiting. The names are one click away on
 * /connections, and putting them here would spread a private, one-to-one
 * interaction onto the screen a member might open with somebody looking
 * over their shoulder.
 */
function ConnectionRequestsCard({ count }: { count: number }) {
  return (
    <section className="mb-10 rounded-lg border border-border-strong bg-white/[0.04] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.95rem] text-text-primary">
            {count === 1
              ? "Someone wants to connect with you"
              : `${count} people want to connect with you`}
          </p>
          <p className="mt-0.5 text-[0.8rem] text-text-muted">
            Accepting means you each see the other&apos;s email address.
          </p>
        </div>
        <Link
          href="/connections?tab=pending"
          className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-border-strong bg-white/[0.05] px-4 py-2 text-[0.8rem] text-text-primary no-underline transition-colors duration-150 hover:border-accent hover:bg-white/[0.10]"
        >
          Review {count === 1 ? "it" : "them"}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-14">
      <div className="mb-5 border-b border-border-subtle pb-3">
        <h2 className="font-display text-[1.4rem] leading-tight tracking-tight text-text-primary">
          {title}
        </h2>
        <p className="mt-0.5 text-[0.825rem] text-text-muted">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

/** The way through to the full listing. A bordered control, not bare text —
 *  it is the one thing on this page you are meant to click after reading. */
function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-5">
      <Link
        href={href}
        className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-white/[0.04] px-4 py-2 text-[0.8rem] text-text-primary no-underline transition-colors duration-150 hover:border-accent hover:bg-white/[0.08]"
      >
        View all {label}
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 w-full" />
      ))}
    </div>
  );
}

function StripSkeleton() {
  return (
    <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-white/[0.02] px-5 py-6 text-[0.85rem] text-text-secondary">
      {children}
    </p>
  );
}

/** The card shell all three listing kinds share on this page. */
function Card({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="block h-full rounded-lg border border-border bg-bg-card p-5 no-underline transition-colors duration-150 hover:border-border-strong hover:bg-bg-card-hover"
      >
        {children}
      </Link>
    </li>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>;
}

async function Newest({ data }: { data: ReturnType<typeof newestMembers> }) {
  return <NewestMembers newest={await data} />;
}

async function Events({ data }: { data: ReturnType<typeof listApprovedEvents> }) {
  const latest = newestFirst(await data, 3);
  if (latest.length === 0) {
    return <Empty>Nothing scheduled yet. Post the first one from the Events page.</Empty>;
  }
  return (
    <Grid>
      {latest.map((e) => (
        <Card key={e.id} href={`/events/${e.id}`}>
          {e.isSocietyEvent && (
            <span className="mb-3 inline-block rounded border border-signal/40 bg-signal-muted px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.1em] text-signal">
              Society event
            </span>
          )}
          <p className="mb-1.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-text-muted">
            {formatDateTime(e.eventAt)}
          </p>
          <p className="mb-2 text-[0.95rem] font-medium leading-snug text-text-primary">
            {e.title}
          </p>
          <p className="text-[0.775rem] text-text-secondary">{e.location}</p>
        </Card>
      ))}
    </Grid>
  );
}

async function Opportunities({ data }: { data: ReturnType<typeof listApprovedOpportunities> }) {
  const latest = newestFirst(await data, 3);
  if (latest.length === 0) {
    return <Empty>No open opportunities right now. Post one from the Opportunities page.</Empty>;
  }
  return (
    <Grid>
      {latest.map((o) => (
        <Card key={o.id} href={`/opportunities/${o.id}`}>
          <p className="mb-1.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-text-muted">
            {o.locationType}
            {o.locationText ? ` · ${o.locationText}` : ""}
          </p>
          <p className="mb-2 text-[0.95rem] font-medium leading-snug text-text-primary">
            {o.positionName}
          </p>
          <p className="text-[0.775rem] text-text-secondary">{o.company}</p>
        </Card>
      ))}
    </Grid>
  );
}

async function Vcs({ data }: { data: ReturnType<typeof newestVcs> }) {
  const latest = await data;
  if (latest.length === 0) {
    return <Empty>No VCs or grants listed yet. Suggest one from the Grants &amp; VCs page.</Empty>;
  }
  return (
    <Grid>
      {latest.map((v) => (
        <Card key={v.id} href={`/vcs/${v.id}`}>
          <p className="mb-1.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-text-muted">
            {v.kind === "vc" ? "VC" : "Grant"}
            {v.stage ? ` · ${v.stage}` : ""}
          </p>
          <p className="mb-2 text-[0.95rem] font-medium leading-snug text-text-primary">
            {v.name}
          </p>
          <p className="text-[0.775rem] text-text-secondary">
            {v.amount ?? (v.deadline ? `Closes ${formatDate(v.deadline)}` : "Rolling applications")}
          </p>
        </Card>
      ))}
    </Grid>
  );
}
